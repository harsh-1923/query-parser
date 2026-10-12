import torch

from qp_train.decoding import marginals, span_confidences, transition_masks, viterbi
from qp_train.spans import bio_to_spans, spans_to_bio


def is_legal(names: list[str]) -> bool:
    prev = "O"
    for tag in names:
        if tag.startswith("I-") and prev[2:] != tag[2:]:
            return False
        prev = tag
    return True


def test_viterbi_never_illegal_on_random_logits(labels):
    trans, start = transition_masks(labels)
    g = torch.Generator().manual_seed(0)
    for _ in range(20):
        b, t = 16, 12
        logits = torch.randn(b, t, len(labels), generator=g) * 3
        lengths = torch.randint(1, t + 1, (b,), generator=g)
        mask = torch.arange(t) < lengths.unsqueeze(1)
        out = viterbi(logits, mask, trans, start)
        for i in range(b):
            assert is_legal([labels.names[k] for k in out[i, : lengths[i]].tolist()])


def test_viterbi_matches_argmax_when_argmax_is_legal(labels):
    trans, start = transition_masks(labels)
    ids = [labels.id_of[t] for t in ["B-KIND", "O", "B-ACTOR", "I-ACTOR", "B-TIME"]]
    logits = torch.full((1, len(ids), len(labels)), -5.0)
    for i, k in enumerate(ids):
        logits[0, i, k] = 5.0
    out = viterbi(logits, torch.ones(1, len(ids), dtype=torch.bool), trans, start)
    assert out[0].tolist() == ids


def test_viterbi_repairs_an_illegal_argmax(labels):
    trans, start = transition_masks(labels)
    ids = [labels.id_of[t] for t in ["I-ACTOR", "O"]]  # cannot start with I-
    logits = torch.full((1, 2, len(labels)), -5.0)
    for i, k in enumerate(ids):
        logits[0, i, k] = 5.0
    out = viterbi(logits, torch.ones(1, 2, dtype=torch.bool), trans, start)
    assert is_legal([labels.names[k] for k in out[0].tolist()])


def test_marginals_are_distributions_and_padding_is_ignored(labels):
    trans, start = transition_masks(labels)
    g = torch.Generator().manual_seed(1)
    logits = torch.randn(3, 6, len(labels), generator=g)
    lengths = torch.tensor([6, 4, 1])
    mask = torch.arange(6) < lengths.unsqueeze(1)
    marg = marginals(logits, mask, trans, start)
    for i, n in enumerate(lengths.tolist()):
        assert torch.allclose(marg[i, :n].sum(-1), torch.ones(n), atol=1e-4)
        assert (marg[i, n:] == 0).all()
        # an example alone, without padding, gives the same marginals
        alone = marginals(logits[i : i + 1, :n], mask[i : i + 1, :n], trans, start)
        assert torch.allclose(alone[0], marg[i, :n], atol=1e-4)
    assert marg[:, 0, [k for k, n in enumerate(labels.names) if n.startswith("I-")]].max() < 1e-6


def test_marginals_match_brute_force(labels):
    trans, start = transition_masks(labels)
    logits = torch.randn(1, 3, len(labels), generator=torch.Generator().manual_seed(2))
    mask = torch.ones(1, 3, dtype=torch.bool)
    emit = torch.log_softmax(logits, -1)[0]
    c = len(labels)
    total = torch.zeros(3, c)
    z = 0.0
    for a in range(c):
        for b in range(c):
            for d in range(c):
                s = start[a] + trans[a, b] + trans[b, d] + emit[0, a] + emit[1, b] + emit[2, d]
                if s < -1e8:
                    continue
                w = torch.exp(s)
                z += w
                total[0, a] += w
                total[1, b] += w
                total[2, d] += w
    assert torch.allclose(marginals(logits, mask, trans, start)[0], total / z, atol=1e-4)


def test_span_confidence_is_min_token_marginal(labels):
    tags = ["B-ACTOR", "I-ACTOR", "O"]
    ids = [labels.id_of[t] for t in tags]
    marg = torch.zeros(3, len(labels))
    marg[0, ids[0]], marg[1, ids[1]], marg[2, ids[2]] = 0.9, 0.6, 0.99
    assert span_confidences(ids, marg, labels) == [(("ACTOR", 0, 1), 0.6000000238418579)]


def test_bio_span_round_trip():
    tags = ["O", "B-KIND", "B-ACTOR", "I-ACTOR", "I-ACTOR", "O", "B-TIME"]
    assert spans_to_bio(bio_to_spans(tags), len(tags)) == tags

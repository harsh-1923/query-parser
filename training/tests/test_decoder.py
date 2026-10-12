import torch

from qp_train.data import collate
from qp_train.model import DECODER_CONFIGS, Decoder
from qp_train.spans import Grammar, bio_to_spans


def test_grammar_masks_reproduce_gold_targets(toy, labels):
    g = Grammar(labels)
    for ex in toy[:100]:
        spans = bio_to_spans(ex.tags)
        target = g.encode(spans)
        masks = g.masks_for(target, len(ex))
        assert all(masks[i, tok] for i, tok in enumerate(target))  # gold is always allowed
        assert g.decode(target) == spans


def test_untrained_decoder_output_is_grounded_and_non_overlapping(toy, labels):
    torch.manual_seed(0)
    model = Decoder(DECODER_CONFIGS["base"], labels).eval()
    batch = collate(toy[:64])
    for spans, n in zip(model.predict_spans(batch), batch.lengths.tolist(), strict=True):
        prev_end = -1
        for _, start, end in spans:
            assert prev_end < start <= end < n
            prev_end = end


def test_decoder_predict_gives_legal_bio_of_right_length(toy, labels):
    torch.manual_seed(1)
    model = Decoder(DECODER_CONFIGS["base"], labels).eval()
    batch = collate(toy[:32])
    for ids, n in zip(model.predict(batch), batch.lengths.tolist(), strict=True):
        assert len(ids) == n
        prev = "O"
        for i in ids:
            tag = labels.names[i]
            assert not tag.startswith("I-") or prev[2:] == tag[2:]
            prev = tag


def test_decoder_loss_is_finite_and_trains(toy, labels):
    torch.manual_seed(0)
    model = Decoder(DECODER_CONFIGS["base"], labels)
    batch = collate(toy[:32])
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3)
    first = model.loss(batch).item()
    for _ in range(30):
        opt.zero_grad()
        model.loss(batch).backward()
        opt.step()
    assert torch.isfinite(torch.tensor(first)) and model.loss(batch).item() < first

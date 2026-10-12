import json

import numpy as np

from qp_train.data import MAX_BYTES, Labels, collate, encode_token, iter_batches
from tests.conftest import TOY


def test_labels_come_from_fixture(labels):
    raw = json.loads(Labels.__init__.__globals__["LABELS_PATH"].read_text())["labels"]
    assert labels.names == raw
    assert len(labels) == 23 and labels.names[0] == "O"


def test_encode_token_shifts_truncates_and_pads():
    assert encode_token("ab").tolist() == [98, 99] + [0] * (MAX_BYTES - 2)
    assert encode_token("é")[:3].tolist() == [196, 170, 0]  # UTF-8 bytes c3 a9, shifted by 1
    long = encode_token("x" * 40)
    assert len(long) == MAX_BYTES and (long > 0).all()


def test_loader_round_trips_toy_file(toy, labels):
    rows = [json.loads(line) for line in TOY.read_text().splitlines()]
    assert len(toy) == len(rows)
    for ex, row in zip(toy, rows, strict=True):
        assert ex.tokens == row["tokens"] and ex.tags == row["tags"]
        assert [labels.names[i] for i in ex.tag_ids] == row["tags"]
        for tok, ids in zip(ex.tokens, ex.bytes_ids, strict=True):
            raw = bytes(int(b) - 1 for b in ids if b)
            assert raw == tok.encode()[:MAX_BYTES]


def test_collate_pads_and_masks(toy):
    batch = collate(toy[:8])
    assert batch.bytes_ids.shape[:2] == batch.mask.shape
    for i, ex in enumerate(toy[:8]):
        n = len(ex)
        assert batch.mask[i].sum() == n
        assert (batch.bytes_ids[i, n:] == 0).all()
        assert np.array_equal(batch.tags[i, :n].numpy(), ex.tag_ids)


def test_shuffle_is_deterministic_and_epoch_dependent(toy):
    def order(seed, epoch):
        return [
            e.text + str(e.offsets)
            for chunk, _ in iter_batches(toy, 32, shuffle=True, seed=seed, epoch=epoch)
            for e in chunk
        ]

    assert order(1, 0) == order(1, 0)
    assert order(1, 0) != order(1, 1)
    assert order(1, 0) != order(2, 0)
    assert sorted(order(1, 0)) == sorted(e.text + str(e.offsets) for e in toy)

from pathlib import Path

import pytest

from qp_train.data import Labels, load_jsonl

TOY = Path(__file__).parent / "fixtures" / "toy.jsonl"


@pytest.fixture(scope="session")
def labels() -> Labels:
    return Labels.load()


@pytest.fixture(scope="session")
def toy(labels):
    return load_jsonl(TOY, labels)

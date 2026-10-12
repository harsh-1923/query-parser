import argparse

import torch

from qp_train.data import Labels, iter_batches, load_jsonl
from qp_train.evaluate import measure_latency, predict_all
from qp_train.metrics import score
from qp_train.model import TAGGER_CONFIGS, Tagger, count_params
from qp_train.runs import load_run
from qp_train.train import evaluate_model, set_determinism, train
from tests.conftest import TOY


def test_tagger_overfits_64_examples(toy, labels):
    set_determinism(0, 2)
    subset = toy[:64]
    model = Tagger(TAGGER_CONFIGS["medium"], labels)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-3)
    for epoch in range(25):
        model.train()
        for _, batch in iter_batches(subset, 16, shuffle=True, seed=0, epoch=epoch):
            opt.zero_grad()
            model.loss(batch).backward()
            opt.step()
    assert evaluate_model(model, subset, labels)["token_acc"] >= 0.9


def test_param_counts_near_targets(labels):
    counts = {k: count_params(Tagger(c, labels)) for k, c in TAGGER_CONFIGS.items()}
    assert 28_000 < counts["small"] < 34_000
    assert 72_000 < counts["medium"] < 88_000
    assert counts["large"] <= 150_000


def test_train_cli_end_to_end_and_reload(tmp_path, labels):
    args = argparse.Namespace(
        model="tagger",
        config="small",
        train=str(TOY),
        val=str(TOY),
        epochs=2,
        batch=64,
        lr=3e-3,
        weight_decay=0.01,
        warmup_frac=0.05,
        clip=1.0,
        label_smoothing=0.0,
        patience=5,
        seed=3,
        threads=2,
        out=str(tmp_path / "run"),
    )
    train(args)
    model, meta = load_run(tmp_path / "run")
    assert meta["model"] == "tagger" and (tmp_path / "run" / "log.jsonl").exists()
    examples = load_jsonl(TOY, labels)[:50]
    result = score(examples, predict_all(model, examples, Labels.load()))
    assert 0.0 <= result["overall"]["f1"] <= 1.0
    assert "p50_ms" in measure_latency(model, examples)["forward"]

"""Generate tests/fixtures/toy.jsonl: a few hundred templated BIO examples (seeded, deterministic).

uv run python tests/fixtures/make_toy.py
"""

import json
import random
import re
from pathlib import Path

FIRST = ["rahul", "priya", "utkarsh", "meera", "arjun", "sneha", "vikram", "anita", "dev", "kavya"]
LAST = ["sharma", "iyer", "gupta", "nair", "verma", "rao", "singh", "das"]
KINDS = ["emails", "pdfs", "tickets", "messages", "docs", "files"]
TOPICS = ["budget", "roadmap", "invoice", "launch", "hiring", "security"]
TIMES = [["last", "week"], ["yesterday"], ["this", "month"], ["last", "year"]]
ATTRS = ["unread", "starred", "urgent"]
CUES = {"ACTOR": "from", "RECIPIENT": "to", "MENTION": "mentioning", "PARTICIPANT": "with"}


def tokenize(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(), m.start(), m.end()) for m in re.finditer(r"\w+|[^\w\s]", text)]


def build(parts: list[tuple[list[str], str | None]], source: str, seed: int) -> dict:
    words, roles = [], []
    for toks, role in parts:
        for i, tok in enumerate(toks):
            words.append(tok)
            roles.append(None if role is None else ("B-" if i == 0 else "I-") + role)
    text = " ".join(words)
    toks = tokenize(text)
    assert [t for t, _, _ in toks] == words
    return {
        "text": text,
        "tokens": words,
        "offsets": [[s, e] for _, s, e in toks],
        "tags": [r or "O" for r in roles],
        "source": source,
        "seed": seed,
    }


def example(rng: random.Random, seed: int) -> dict:
    name = [rng.choice(FIRST)] + ([rng.choice(LAST)] if rng.random() < 0.4 else [])
    role = rng.choice(list(CUES))
    parts: list[tuple[list[str], str | None]] = []
    if rng.random() < 0.15:
        parts = [([rng.choice(["hello", "thanks", "ok"]), "there"], None)]
        return build(parts, "toy/negative", seed)
    if rng.random() < 0.3:
        parts.append(([rng.choice(ATTRS)], "ATTR"))
    parts.append(([rng.choice(KINDS)], "KIND"))
    cued = rng.random() < 0.6
    if cued:
        parts.append(([CUES[role]], None))
    parts.append((name, role))
    if rng.random() < 0.5:
        parts.append((["about"], None))
        parts.append(([rng.choice(TOPICS)], "TOPIC"))
    if rng.random() < 0.5:
        parts.append((rng.choice(TIMES), "TIME"))
    return build(parts, "toy/cue" if cued else "toy/nocue", seed)


def main() -> None:
    rng = random.Random(7)
    rows = [example(rng, i) for i in range(400)]
    path = Path(__file__).parent / "toy.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    print(f"wrote {len(rows)} rows to {path}")


if __name__ == "__main__":
    main()

# S06: Runtime performance — result

Date: 2026-10-12 · Status: **pass (phone budget measured on a throttled-CPU proxy, not a real
phone)** · Decision: plain TypeScript inference, no WASM or WebGPU; int8 weights cost nothing at
runtime

## Question

Does plain TypeScript inference for a ≤150k-parameter tagger handle a 10-token query in **≤ 5 ms p95
on a laptop** and **≤ 20 ms on a mid-range Android phone**, including resolution against a
1,000-person directory?

## What was run

All under [`spikes/S06-runtime/`](../../spikes/S06-runtime/), run by a Sonnet subagent.
- **Model** ([`model.ts`](../../spikes/S06-runtime/model.ts)). The PLAN §6.2 architecture with
  **random weights** from a seeded PRNG; speed doesn't depend on the values.
  - Byte embedding, then a conv and max-pool per token, then pre-LN transformer layers, then a linear
    head, then constrained Viterbi.
  - Hand-written `Float32Array` matmuls.
  - Two weight formats: float32, and int8 per-row with float32 scales, dequantized inside the matmul.
- **Benchmark** ([`bench.ts`](../../spikes/S06-runtime/bench.ts)). 2,000 warm iterations over 50
  queries, plus fixed-length queries of 5, 10, 20 and 30 tokens. "End to end" adds `tokenize` and
  `directorySource` resolution of 1–2 names against a deterministic 1,000-person directory.
- **Environments:**
  - Node 26.8.1 on an Apple M5 Pro.
  - The built-in browser pane (Chromium 152).
  - Headless Chrome 155 with DevTools CPU throttling at 4× and 6×
    ([`cdp-throttle.mjs`](../../spikes/S06-runtime/cdp-throttle.mjs)).
- **Configs:**
  - small (47,895 params);
  - medium (78,871): the shape S01 picked, whose trained version has 77,623;
  - large (161,879), over the 150k budget;
  - large-fit (126,031).

## Results

10-token query, p95 in ms. Raw output in [`results.txt`](../../spikes/S06-runtime/results.txt),
[`results-browser-pane.txt`](../../spikes/S06-runtime/results-browser-pane.txt),
[`results-browser-4x.txt`](../../spikes/S06-runtime/results-browser-4x.txt) and
[`results-browser-6x.txt`](../../spikes/S06-runtime/results-browser-6x.txt).

| Config | Node model | Node end to end | Browser model | Chrome 6× model | **Chrome 6× end to end** |
|---|---|---|---|---|---|
| small f32 | 0.54 | 0.81 | 0.51 | 3.96 | 5.69 |
| **medium f32** | **0.90** | **1.23** | 0.89 | **6.32** | **7.96** |
| medium int8 | 0.91 | 1.20 | 0.93 | 6.33 | 8.19 |
| large-fit f32 | 1.42 | 1.68 | 1.42 | 9.09 | 10.76 |
| large f32 | 1.83 | 2.11 | 1.73 | 11.74 | 13.51 |

- **Laptop budget (≤ 5 ms): met with large margin.** Medium runs end to end at 1.23 ms p95; even the
  over-budget large is at 2.1 ms.
- **Phone budget (≤ 20 ms): met on the proxy.** At 6× CPU slowdown, medium is 7.96 ms end to end;
  every config stays under 14 ms.
- **Directory resolution is a small share.** It takes 0.29 ms p95 on the laptop and about 2.4 ms at
  6×; building the 1,000-person index is a one-off 7 ms.
- **int8 is free at runtime.** Dequantizing in the matmul costs 0–5%. That keeps int8 (4× smaller
  weights, PLAN §6.3) as the shipping format.
- **Cost grows linearly with length.** Medium: 0.43 / 0.90 / 1.93 / 3.04 ms p95 for 5 / 10 / 20 /
  30 tokens on Node.

## Decision

- **Pass.** Plain TypeScript is fast enough on both budgets, with no WASM SIMD and no WebGPU, so it
  runs in Node, browsers and React Native alike.
- **Ship int8 weights** (no runtime cost).
- **Medium (~78k) is the config.** It matches S01's choice and leaves about 2.5× headroom on the
  phone budget.

## Caveats

- **No real phone was measured.** 6× DevTools throttling slows down JS execution but doesn't model a
  phone's memory bandwidth, thermal throttling or JIT warmup. One run on an actual mid-range Android
  (e.g. Snapdragon 6-series) before M4 ships would close this.
- The weights are random. Speed doesn't depend on values, but the trained medium has 77,623 params
  against 78,871 here; that difference is negligible.
- These are warm, single-threaded numbers after 2,000 iterations. The first parse after load also
  pays JIT and weight-decoding cost.

# S06: runtime performance

Throwaway spike code. Result: [docs/spikes/S06-runtime.md](../../docs/spikes/S06-runtime.md).

- `model.ts`: random-weight tagger forward pass (f32 and int8) + constrained Viterbi.
- `bench-core.ts`, `bench.ts`: the benchmark; `node spikes/S06-runtime/bench.ts > results.txt`.
- `browser-entry.ts`, `bench.html`: the same benchmark in a page. Build `bundle.js` with
  `spikes/S04-time/node_modules/.bin/esbuild spikes/S06-runtime/browser-entry.ts --bundle --format=esm --outfile=spikes/S06-runtime/bundle.js`,
  serve with `node spikes/S06-runtime/serve.mjs`.
- `cdp-throttle.mjs <url> <rate> <iters>`: headless Chrome with DevTools CPU throttling.
- `results*.txt`: raw outputs used in the write-up.

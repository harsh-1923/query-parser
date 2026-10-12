@AGENTS.md

## Claude-specific notes

- Before starting a task, check which milestone it belongs to in `docs/PLAN.md` §14 and whether a
  spike in `docs/SPIKES.md` gates it.
- When a task reveals that the plan is wrong, say so and propose a plan edit or decision record
  instead of quietly working around it.
- Run `pnpm check` before committing. For training work, run the relevant parity fixture too.
- Keep spike code in `spikes/` and write the result to `docs/spikes/` before moving on.

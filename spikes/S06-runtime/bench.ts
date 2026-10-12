// node spikes/S06-runtime/bench.ts
import { registerHooks } from "node:module"
import { cpus } from "node:os"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) return nextResolve(`${specifier}.ts`, context)
      throw error
    }
  },
})

const { directorySource } = await import("../../packages/core/src/directorySource.ts")
const { runBench } = await import("./bench-core.ts")
const log = (s) => console.log(s)
log(`node ${process.version} ${process.platform}/${process.arch} cpu=${cpus()[0].model}`)
runBench({ directorySource, now: () => performance.now(), log })

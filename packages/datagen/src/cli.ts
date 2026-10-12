// Usage: node packages/datagen/src/cli.ts --seed 42 --train 60000 --val 2000 --test 3000 \
//          --out eval/datasets/generated/v1
// Registers a resolve hook so Node can load the extensionless relative imports used in packages/.
import { registerHooks } from "node:module"

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
})

await import("./main")

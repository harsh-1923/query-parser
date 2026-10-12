import { defineConfig } from "vite"

export default defineConfig({
  define: {
    // Vercel sets this at build time, so the page can say which push it was built from.
    __COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? "local"),
  },
})

import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: {
    // Vercel sets this at build time, so the page can say which push it was built from.
    __COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? "local"),
  },
})

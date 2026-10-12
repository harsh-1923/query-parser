import { createServer } from "node:http"
import { readFileSync } from "node:fs"
const dir = new URL(".", import.meta.url)
createServer((req, res) => {
  const f = req.url.startsWith("/bundle.js") ? "bundle.js" : "bench.html"
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin")
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp")
  res.setHeader("Content-Type", f.endsWith(".js") ? "text/javascript" : "text/html")
  res.end(readFileSync(new URL(f, dir)))
}).listen(0, "127.0.0.1", function () { console.log("http://127.0.0.1:" + this.address().port + "/") })

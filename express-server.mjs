import express from "express"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = 3144
const HOST = "0.0.0.0"

app.use(express.static(resolve(__dirname, "dist")))

app.get("/{*path}", (_req, res) => {
  res.sendFile(resolve(__dirname, "dist", "index.html"))
})

app.listen(PORT, HOST, () => {
  console.log(`Express server running at http://${HOST}:${PORT}`)
})

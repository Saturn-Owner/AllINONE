import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [{
    name: "allinone-offline-version",
    apply: "build",
    async closeBundle() {
      const directory = resolve("dist");
      const html = await readFile(resolve(directory, "index.html"), "utf8");
      const workerPath = resolve(directory, "sw.js");
      const worker = await readFile(workerPath, "utf8");
      const build = createHash("sha256").update(html).update(worker).digest("hex").slice(0, 20);
      await writeFile(workerPath, worker.replace(/const CACHE = "[^"]+";/, `const CACHE = "allinone-shell-${build}";`));
    }
  }],
  server: {
    proxy: { "/api": "http://127.0.0.1:4174" }
  }
});

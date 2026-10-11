import { build as bundle } from "esbuild";
import { zipSync } from "fflate";
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
      const extension = await bundle({ entryPoints: ["extension/popup.ts"], bundle: true, write: false, format: "iife", target: "chrome120" });
      const files: Record<string, Uint8Array> = { "popup.js": extension.outputFiles[0].contents };
      for (const name of ["manifest.json", "popup.html", "popup.css"]) files[name] = await readFile(resolve("extension", name));
      await writeFile(resolve(directory, "allinone-extension.zip"), zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") }));
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

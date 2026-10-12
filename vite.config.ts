import { build as bundle } from "esbuild";
import { zipSync } from "fflate";
import { defineConfig } from "vite";
import { buildFingerprint } from "./scripts/build-fingerprint";
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
      await writeFile(resolve(directory, "allinone-extension.zip"), zipSync(files, { mtime: new Date(1980, 0, 1) }));
      const workerPath = resolve(directory, "sw.js");
      const worker = await readFile(workerPath, "utf8");
      const build = await buildFingerprint(directory);
      await writeFile(workerPath, worker.replace(/const CACHE = "[^"]+";/, `const CACHE = "allinone-shell-${build}";`));
    }
  }],
  server: {
    proxy: { "/api": "http://127.0.0.1:4174" }
  }
});

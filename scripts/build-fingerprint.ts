import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
export async function buildFingerprint(directory: string): Promise<string> {
  const digest = createHash("sha256");
  const include = async (path: string, prefix = "") => {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await include(resolve(path, entry.name), `${name}/`);
      else digest.update(name).update("\0").update(await readFile(resolve(path, entry.name))).update("\0");
    }
  };
  await include(directory);
  return digest.digest("hex").slice(0, 20);
}

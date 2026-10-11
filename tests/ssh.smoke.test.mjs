import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hashPassword } from "../server/auth.mjs";
import { createApp } from "../server/index.mjs";

async function freePort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("local OpenSSH SFTP lists, uploads and downloads within the allowed directory", { timeout: 30000 }, async (t) => {
  if (spawnSync("sshd", ["-V"]).error || spawnSync("ssh-keygen", ["-h"]).error) return t.skip("OpenSSH not installed");
  const root = await mkdtemp(join(tmpdir(), "allinone-sftp-"));
  const filesDir = join(root, "files");
  await mkdir(filesDir);
  for (const name of ["host", "user"]) {
    const created = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", join(root, name)]);
    assert.equal(created.status, 0, created.stderr?.toString());
  }
  await writeFile(join(root, "authorized_keys"), await readFile(join(root, "user.pub")), { mode: 0o600 });
  const fingerprint = spawnSync("ssh-keygen", ["-lf", join(root, "host.pub"), "-E", "sha256"]).stdout.toString().match(/SHA256:[A-Za-z0-9+/]+/)?.[0];
  assert.ok(fingerprint);
  const sshPort = await freePort();
  const config = [
    `Port ${sshPort}`, "ListenAddress 127.0.0.1", `HostKey ${join(root, "host")}`, `PidFile ${join(root, "sshd.pid")}`,
    `AuthorizedKeysFile ${join(root, "authorized_keys")}`, "PasswordAuthentication no", "KbdInteractiveAuthentication no",
    "PubkeyAuthentication yes", "PermitRootLogin no", "AllowUsers agent", "UsePAM no", "StrictModes no",
    "Subsystem sftp internal-sftp", "LogLevel ERROR"
  ].join("\n");
  await writeFile(join(root, "sshd_config"), `${config}\n`);
  const sshdPath = spawnSync("which", ["sshd"]).stdout.toString().trim();
  const sshd = spawn(sshdPath, ["-D", "-e", "-f", join(root, "sshd_config")], { stdio: ["ignore", "ignore", "pipe"] });
  let sshLog = "";
  sshd.stderr.on("data", (chunk) => { sshLog += chunk.toString(); });
  const origin = "http://127.0.0.1:4180";
  const app = createApp({ publicOrigin: origin, passwordHash: await hashPassword("lange Server Testpassphrase"), dataDir: root, distDir: root,
    hosts: [{ id: "local", label: "Testserver", host: "127.0.0.1", port: sshPort, username: "agent", privateKeyPath: join(root, "user"), hostFingerprint: fingerprint, rootPath: filesDir }] });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${app.address().port}`;
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const login = await fetch(`${url}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "lange Server Testpassphrase" }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    let response = await fetch(`${url}/api/hosts/local/upload?path=hello.txt`, { method: "PUT", headers: { origin, cookie }, body: "hello world" });
    assert.equal(response.status, 200, `${await response.text()} ${sshLog}`);
    response = await fetch(`${url}/api/hosts/local/files?path=`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.ok((await response.json()).some((file) => file.name === "hello.txt"));
    response = await fetch(`${url}/api/hosts/local/download?path=hello.txt`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "hello world");
    response = await fetch(`${url}/api/hosts/local/metrics`, { headers: { cookie } });
    assert.equal(response.status, 200, "Linux monitoring failed");
    const metrics = await response.json();
    assert.ok(metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100);
    assert.ok(metrics.memoryTotal > 0 && metrics.diskTotal > 0);
    await symlink("/etc/passwd", join(filesDir, "escape"));
    response = await fetch(`${url}/api/hosts/local/download?path=escape`, { headers: { cookie } });
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    sshd.kill("SIGTERM");
    await rm(root, { recursive: true, force: true });
  }
});

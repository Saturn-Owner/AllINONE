import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "../server/auth.mjs";
import { createApp } from "../server/index.mjs";
import ssh2 from "ssh2";

test("self-hosted server enforces login, origin and revision conflicts", async () => {
  const root = await mkdtemp(join(tmpdir(), "allinone-server-"));
  const distDir = join(root, "dist");
  await mkdir(distDir);
  await writeFile(join(distDir, "index.html"), "<!doctype html><title>AllINONE</title>");
  const origin = "http://127.0.0.1:4178";
  const server = createApp({ publicOrigin: origin, passwordHash: await hashPassword("eine lange Testpassphrase"), dataDir: join(root, "data"), distDir, hosts: [] });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    let response = await fetch(`${url}/api/sync`);
    assert.equal(response.status, 401);
    response = await fetch(`${url}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "eine lange Testpassphrase" }) });
    assert.equal(response.status, 403);
    response = await fetch(`${url}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "falsch" }) });
    assert.equal(response.status, 401);
    response = await fetch(`${url}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "eine lange Testpassphrase" }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    assert.match(response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    const envelope = { version: 1, cipher: { data: "encrypted-data" } };
    response = await fetch(`${url}/api/sync`, { method: "PUT", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify({ revision: null, envelope }) });
    assert.equal(response.status, 200);
    const { revision } = await response.json();
    assert.ok(revision);
    response = await fetch(`${url}/api/sync`, { method: "PUT", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify({ revision: null, envelope }) });
    assert.equal(response.status, 409);
    response = await fetch(`${url}/api/sync`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).revision, revision);
    assert.equal((await readFile(join(root, "data", "vault.json"), "utf8")).includes("eine lange Testpassphrase"), false);
    response = await fetch(`${url}/api/hosts`, { headers: { cookie } });
    assert.deepEqual(await response.json(), []);
    response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /object-src 'none'/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("VPS status uses pinned SSH host key and configured public key", async () => {
  const { Server, utils } = ssh2;
  const hostKeys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const userKeys = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs1" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const expectedKey = utils.parseKey(userKeys.privateKey).getPublicSSH();
  const fingerprint = `SHA256:${createHash("sha256").update(utils.parseKey(hostKeys.privateKey).getPublicSSH()).digest("base64").replace(/=$/, "")}`;
  const sshServer = new Server({ hostKeys: [hostKeys.privateKey] }, (client) => {
    client.on("authentication", (ctx) => {
      if (ctx.method === "publickey" && ctx.username === "tester" && Buffer.compare(ctx.key.data, expectedKey) === 0
        && (!ctx.signature || utils.parseKey(userKeys.privateKey).verify(ctx.blob, ctx.signature, ctx.hashAlgo))) ctx.accept();
      else ctx.reject();
    }).on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (accept, _reject, info) => {
          assert.equal(info.command, "hostname; uptime -p; df -h /; free -m");
          const stream = accept();
          stream.write("test-host\nup 1 hour\n");
          stream.exit(0); stream.end();
        });
      });
    });
  });
  await new Promise((resolve) => sshServer.listen(0, "127.0.0.1", resolve));
  const root = await mkdtemp(join(tmpdir(), "allinone-ssh-"));
  const keyPath = join(root, "user.key");
  await writeFile(keyPath, userKeys.privateKey, { mode: 0o600 });
  const origin = "http://127.0.0.1:4179";
  const app = createApp({ publicOrigin: origin, passwordHash: await hashPassword("lange Server Testpassphrase"), dataDir: root, distDir: root,
    hosts: [{ id: "local", label: "Testserver", host: "127.0.0.1", port: sshServer.address().port, username: "tester", privateKeyPath: keyPath, hostFingerprint: fingerprint, rootPath: "/tmp" }] });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${app.address().port}`;
    const response = await fetch(`${url}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ password: "lange Server Testpassphrase" }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const status = await fetch(`${url}/api/hosts/local/status`, { headers: { cookie } });
    assert.equal(status.status, 200);
    assert.match((await status.json()).output, /test-host/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => sshServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

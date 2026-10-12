import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../server/index.mjs";
import { createVault } from "../src/vault.ts";
import { hashPassword } from "../server/auth.mjs";

test("API rejects malformed data, limits parallel logins, preserves the last valid vault and enforces failed-login lockout", async () => {
  const root = await mkdtemp(join(tmpdir(), "aio-server-review-"));
  const password = "Review server Passphrase lang";
  const hash = await hashPassword(password); const origin = "http://127.0.0.1:4188";
  assert.throws(() => createApp({ publicOrigin: origin, passwordHash: "not-a-hash", dataDir: root }), /scrypt-Hash/);
  const server = createApp({ publicOrigin: origin, passwordHash: hash, dataDir: root, distDir: root }); await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const login = (payload) => fetch(`${url}/api/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(payload) });
  try {
    assert.equal((await login(null)).status, 400);
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => login({ password })));
    assert.equal(concurrent.filter((r) => r.status === 200).length, 1); assert.equal(concurrent.filter((r) => r.status === 429).length, 7);
    const cookie = concurrent.find((r) => r.status === 200).headers.get("set-cookie").split(";")[0];
    const put = (payload) => fetch(`${url}/api/sync`, { method: "PUT", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal((await put(null)).status, 400); assert.equal((await put({ revision: null, envelope: { version: 1, cipher: { data: "broken" } } })).status, 400);
    const { envelope } = await createVault("Review encrypted Passphrase lang");
    const good = await put({ revision: null, envelope: { ...envelope, unexpected: "MUST_NOT_PERSIST" } }); assert.equal(good.status, 200); const { revision } = await good.json();
    assert.equal((await put({ revision, envelope: { ...envelope, kdf: null } })).status, 400);
    const stored = await (await fetch(`${url}/api/sync`, { headers: { cookie } })).json(); assert.equal(stored.revision, revision); assert.deepEqual(stored.envelope, envelope);
    const raced = await Promise.all([put({ revision, envelope }), put({ revision, envelope })]); assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
    for (let i = 0; i < 5; i++) assert.equal((await login({ password: "wrong" })).status, 401);
    assert.equal((await login({ password })).status, 429);
  } finally { await new Promise((r) => server.close(r)); await rm(root, { recursive: true, force: true }); }
});

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { handleAI } from "../server/ai.mjs";
import { parseMetrics } from "../server/ssh.mjs";

test("Ollama receives only the approved note and action; unconfigured or unapproved requests fail", async () => {
  await assert.rejects(handleAI({ consent: true }, {}), /nicht eingerichtet/);
  await assert.rejects(handleAI({ title: "x", body: "y", action: "tasks", consent: false }, { url: "http://127.0.0.1:1" }), /Freigabe/);
  let received;
  const upstream = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c); received = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(req.url, "/api/chat"); res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ message: { content: "- Unterlagen prüfen\n- Termin planen" } }));
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  try {
    const result = await handleAI({ consent: true, title: "Plan", body: "Termin mit Unterlagen", action: "tasks", passwords: "MUST_NOT_SEND", otherNotes: "MUST_NOT_SEND" }, { url: `http://127.0.0.1:${upstream.address().port}`, model: "testmodel" });
    assert.match(result.text, /Unterlagen prüfen/); assert.equal(received.model, "testmodel"); assert.equal(received.messages[1].content, "Plan\n\nTermin mit Unterlagen"); assert.equal(JSON.stringify(received).includes("MUST_NOT_SEND"), false);
  } finally { await new Promise((r) => upstream.close(r)); }
});
test("VPS metrics calculate CPU from a sample delta and reject malformed output", () => {
  const metrics = parseMetrics("cpu 10 0 10 80 0 0 0 0\ncpu 20 0 20 160 0 0 0 0\nMEM 1000 250\nDISK 2000 1000\n");
  assert.equal(metrics.cpuPercent, 19.999999999999996); assert.equal(metrics.memoryPercent, 75); assert.equal(metrics.diskPercent, 50);
  assert.throws(() => parseMetrics("broken"));
});

import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPassword } from "./auth.mjs";
import { handleHostRequest, loadHosts } from "./ssh.mjs";

const baseDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_SYNC_BYTES = 10_000_000;

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(body), ...headers });
  res.end(body);
}

async function bodyBuffer(req, limit) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Anfrage zu groß."), { status: 413 });
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

async function bodyJson(req, limit) {
  try { return JSON.parse((await bodyBuffer(req, limit)).toString("utf8")); }
  catch (error) { if (error.status) throw error; throw Object.assign(new Error("Ungültiges JSON."), { status: 400 }); }
}

function getCookie(req, name) {
  const cookie = req.headers.cookie?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return cookie?.slice(name.length + 1) || "";
}

async function serveStatic(req, res, distDir, path) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Methode nicht erlaubt." });
  let name;
  try { name = decodeURIComponent(path); } catch { return json(res, 400, { error: "Ungültiger Pfad." }); }
  const target = resolve(distDir, `.${name === "/" ? "/index.html" : name}`);
  if (target !== resolve(distDir) && !target.startsWith(`${resolve(distDir)}${sep}`)) return json(res, 403, { error: "Verboten." });
  const known = [".html", ".js", ".css", ".png", ".webmanifest", ".svg", ".ico"];
  if (!known.includes(extname(target))) return json(res, 404, { error: "Nicht gefunden." });
  try {
    const data = await readFile(target);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
    res.writeHead(200, { "content-type": `${types[extname(target)]}; charset=utf-8`, "content-length": data.length, "cache-control": extname(target) === ".html" ? "no-cache" : "public, max-age=3600" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch { json(res, 404, { error: "Nicht gefunden." }); }
}

export function createApp(config) {
  const publicOrigin = new URL(config.publicOrigin).origin;
  if (!publicOrigin.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicOrigin)) {
    throw new Error("PUBLIC_ORIGIN muss HTTPS verwenden (außer localhost).");
  }
  if (!config.passwordHash) throw new Error("APP_PASSWORD_HASH fehlt.");
  const dataDir = resolve(config.dataDir);
  const distDir = resolve(config.distDir || resolve(baseDir, "dist"));
  const sessions = new Map();
  const attempts = new Map();
  let syncQueue = Promise.resolve();
  const locked = (fn) => {
    const result = syncQueue.then(fn);
    syncQueue = result.catch(() => undefined);
    return result;
  };

  const server = createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("content-security-policy", "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self'; img-src 'self' data:; connect-src 'self' https://www.googleapis.com https://accounts.google.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    try {
      const url = new URL(req.url || "/", publicOrigin);
      if (!url.pathname.startsWith("/api/")) return await serveStatic(req, res, distDir, url.pathname);
      if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && req.headers.origin !== publicOrigin) {
        return json(res, 403, { error: "Origin nicht erlaubt." });
      }
      if (url.pathname === "/api/login" && req.method === "POST") {
        const address = req.socket.remoteAddress || "unknown";
        const entry = attempts.get(address) || { count: 0, until: 0 };
        if (entry.until > Date.now()) return json(res, 429, { error: "Zu viele Anmeldeversuche." });
        const payload = await bodyJson(req, 4096);
        const valid = await verifyPassword(payload.password, config.passwordHash);
        if (!valid) {
          entry.count++;
          if (entry.count >= 5) { entry.until = Date.now() + 15 * 60 * 1000; entry.count = 0; }
          attempts.set(address, entry);
          return json(res, 401, { error: "Anmeldung fehlgeschlagen." });
        }
        attempts.delete(address);
        const token = randomBytes(32).toString("base64url");
        sessions.set(token, Date.now() + SESSION_MS);
        const secure = publicOrigin.startsWith("https://") ? "; Secure" : "";
        return json(res, 200, { authenticated: true }, { "set-cookie": `aio_session=${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200${secure}` });
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        const expires = sessions.get(getCookie(req, "aio_session"));
        return json(res, 200, { authenticated: Boolean(expires && expires > Date.now()) });
      }
      const token = getCookie(req, "aio_session");
      const expires = sessions.get(token);
      if (!expires || expires <= Date.now()) { sessions.delete(token); return json(res, 401, { error: "Anmeldung erforderlich." }); }
      if (url.pathname === "/api/logout" && req.method === "POST") {
        sessions.delete(token);
        return json(res, 200, { authenticated: false }, { "set-cookie": "aio_session=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0" });
      }
      if (url.pathname === "/api/sync" && req.method === "GET") {
        let current = null;
        try { current = JSON.parse(await readFile(resolve(dataDir, "vault.json"), "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        return json(res, 200, current || { revision: null, envelope: null });
      }
      if (url.pathname === "/api/sync" && req.method === "PUT") {
        const payload = await bodyJson(req, MAX_SYNC_BYTES);
        if ((payload.revision !== null && typeof payload.revision !== "string") || !payload.envelope
          || payload.envelope.version !== 1 || typeof payload.envelope.cipher?.data !== "string") {
          return json(res, 400, { error: "Ungültige Tresordaten." });
        }
        const result = await locked(async () => {
          await mkdir(dataDir, { recursive: true, mode: 0o700 });
          const path = resolve(dataDir, "vault.json");
          let current = null;
          try { current = JSON.parse(await readFile(path, "utf8")); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
          if (payload.revision !== (current?.revision || null)) return { conflict: true, revision: current?.revision || null };
          const revision = randomUUID();
          const temp = resolve(dataDir, `.vault-${revision}.tmp`);
          await writeFile(temp, JSON.stringify({ revision, envelope: payload.envelope }), { mode: 0o600, flag: "wx" });
          await rename(temp, path);
          return { revision };
        });
        return result.conflict ? json(res, 409, { error: "Synchronisationskonflikt.", revision: result.revision }) : json(res, 200, result);
      }
      if (url.pathname.startsWith("/api/hosts")) return await handleHostRequest(req, res, url, config.hosts || [], bodyBuffer, json);
      return json(res, 404, { error: "Nicht gefunden." });
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : "Serverfehler." });
    }
  });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const hosts = await loadHosts(process.env.HOSTS_FILE);
    const server = createApp({
      publicOrigin: process.env.PUBLIC_ORIGIN || "", passwordHash: process.env.APP_PASSWORD_HASH,
      dataDir: process.env.DATA_DIR || resolve(baseDir, "data"), distDir: resolve(baseDir, "dist"), hosts
    });
    const port = Number(process.env.PORT || 4174);
    server.listen(port, "0.0.0.0", () => process.stdout.write(`AllINONE server ready on port ${port}\n`));
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

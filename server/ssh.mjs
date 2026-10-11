import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { Client } from "ssh2";

const MAX_FILE_BYTES = 10_000_000;

export async function loadHosts(path) {
  if (!path) return [];
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(value) || value.length > 20) throw new Error("HOSTS_FILE muss eine Liste mit höchstens 20 Hosts enthalten.");
  const ids = new Set();
  for (const host of value) {
    if (!/^[a-z0-9_-]{1,40}$/.test(host.id) || ids.has(host.id)
      || typeof host.label !== "string" || typeof host.host !== "string" || !host.host
      || !Number.isInteger(host.port) || host.port < 1 || host.port > 65535
      || typeof host.username !== "string" || !host.username
      || typeof host.privateKeyPath !== "string" || !host.privateKeyPath.startsWith("/")
      || typeof host.hostFingerprint !== "string" || !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(host.hostFingerprint)
      || typeof host.rootPath !== "string" || !host.rootPath.startsWith("/") || host.rootPath === "/") {
      throw new Error("Ungültiger Host-Eintrag in HOSTS_FILE.");
    }
    ids.add(host.id);
  }
  return value;
}

async function connect(host) {
  const privateKey = await readFile(host.privateKeyPath);
  const client = new Client();
  try {
    await new Promise((resolve, reject) => {
      client.once("ready", resolve).once("error", reject);
      client.connect({
        host: host.host, port: host.port, username: host.username, privateKey,
        readyTimeout: 10000,
        hostVerifier: (key) => `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=$/, "")}` === host.hostFingerprint.replace(/=$/, "")
      });
    });
    return client;
  } catch (error) { client.end(); throw error; }
  finally { privateKey.fill(0); }
}

async function withClient(host, operation) {
  const client = await connect(host);
  try { return await operation(client); }
  finally { client.end(); }
}

function getSftp(client) {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

function call(sftp, method, ...args) {
  return new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)));
}

async function realPath(sftp, path) {
  return await call(sftp, "realpath", path);
}

async function allowedPath(sftp, host, relative, forCreate = false) {
  if (typeof relative !== "string" || relative.includes("\0") || relative.startsWith("/") || relative.length > 2048) {
    throw Object.assign(new Error("Ungültiger Dateipfad."), { status: 400 });
  }
  const root = await realPath(sftp, host.rootPath);
  const clean = posix.normalize(`/${relative}`).slice(1);
  const candidate = posix.join(root, clean);
  const checked = forCreate ? await realPath(sftp, posix.dirname(candidate)) : await realPath(sftp, candidate);
  if (checked !== root && !checked.startsWith(`${root}/`)) {
    throw Object.assign(new Error("Pfad außerhalb des freigegebenen Bereichs."), { status: 403 });
  }
  if (forCreate && (!posix.basename(candidate) || posix.basename(candidate) === ".")) {
    throw Object.assign(new Error("Dateiname fehlt."), { status: 400 });
  }
  return candidate;
}

async function status(client) {
  const command = "hostname; uptime -p; df -h /; free -m";
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let output = "";
      stream.on("data", (chunk) => { output += chunk.toString(); if (output.length > 32768) stream.close(); });
      stream.stderr.on("data", (chunk) => { output += chunk.toString(); });
      stream.on("close", (code) => code === 0 ? resolve(output.slice(0, 32768)) : reject(new Error(`Statusbefehl fehlgeschlagen: ${code}`)));
      stream.on("error", reject);
    });
  });
}

export async function handleHostRequest(req, res, url, hosts, bodyBuffer, json) {
  if (url.pathname === "/api/hosts" && req.method === "GET") {
    return json(res, 200, hosts.map(({ id, label }) => ({ id, label })));
  }
  const match = /^\/api\/hosts\/([a-z0-9_-]+)\/(status|files|download|upload)$/.exec(url.pathname);
  if (!match) return json(res, 404, { error: "Nicht gefunden." });
  const host = hosts.find((item) => item.id === match[1]);
  if (!host) return json(res, 404, { error: "Host nicht gefunden." });
  const action = match[2];
  if ((action === "upload" && req.method !== "PUT") || (action !== "upload" && req.method !== "GET")) {
    return json(res, 405, { error: "Methode nicht erlaubt." });
  }
  const upload = action === "upload" ? await bodyBuffer(req, MAX_FILE_BYTES) : null;
  try {
    const result = await withClient(host, async (client) => {
      if (action === "status") return { output: await status(client) };
      const sftp = await getSftp(client);
      const relative = url.searchParams.get("path") || "";
      if (action === "files") {
        const path = await allowedPath(sftp, host, relative);
        const files = await call(sftp, "readdir", path);
        return files.map((file) => ({ name: file.filename, directory: file.attrs.isDirectory(), size: file.attrs.size }));
      }
      if (action === "download") {
        const path = await allowedPath(sftp, host, relative);
        const attrs = await call(sftp, "stat", path);
        if (!attrs.isFile()) throw Object.assign(new Error("Keine Datei."), { status: 400 });
        if (attrs.size > MAX_FILE_BYTES) throw Object.assign(new Error("Datei zu groß."), { status: 413 });
        const data = await call(sftp, "readFile", path);
        if (data.length > MAX_FILE_BYTES) throw Object.assign(new Error("Datei zu groß."), { status: 413 });
        return { filename: posix.basename(path), data };
      }
      const path = await allowedPath(sftp, host, relative, true);
      await call(sftp, "writeFile", path, upload, { flag: "wx", mode: 0o600 });
      return { uploaded: true, bytes: upload.length };
    });
    if (action === "download") {
      const filename = result.filename.replace(/[^A-Za-z0-9._-]/g, "_");
      res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${filename}"`, "content-length": result.data.length, "cache-control": "no-store" });
      return res.end(result.data);
    }
    return json(res, 200, result);
  } catch (error) {
    return json(res, error.status || 502, { error: error.status ? error.message : "SSH-Verbindung oder Dateioperation fehlgeschlagen." });
  }
}

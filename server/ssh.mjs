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
    if (!host || typeof host !== "object" || typeof host.id !== "string" || !/^[a-z0-9_-]{1,40}$/.test(host.id) || ids.has(host.id)
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
  let timer;
  try {
    return await Promise.race([operation(client), new Promise((_, reject) => {
      timer = setTimeout(() => { client.end(); reject(Object.assign(new Error("SSH-Zeitlimit überschritten."), { status: 504 })); }, 20000);
    })]);
  } finally { clearTimeout(timer); client.end(); }
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
  if (typeof relative !== "string" || relative.includes("\0") || relative.startsWith("/") || relative.length > 2048 || relative.split("/").includes("..")) {
    throw Object.assign(new Error("Ungültiger Dateipfad."), { status: 400 });
  }
  const root = await realPath(sftp, host.rootPath);
  if (root === "/") throw Object.assign(new Error("Das Stammverzeichnis darf nicht freigegeben werden."), { status: 403 });
  const clean = posix.normalize(`/${relative}`).slice(1);
  const candidate = posix.join(root, clean);
  const checked = forCreate ? await realPath(sftp, posix.dirname(candidate)) : await realPath(sftp, candidate);
  if (checked !== root && !checked.startsWith(`${root}/`)) {
    throw Object.assign(new Error("Pfad außerhalb des freigegebenen Bereichs."), { status: 403 });
  }
  if (forCreate && (!posix.basename(candidate) || posix.basename(candidate) === ".")) {
    throw Object.assign(new Error("Dateiname fehlt."), { status: 400 });
  }
  return forCreate ? posix.join(checked, posix.basename(candidate)) : checked;
}

async function execBounded(client, command) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.end(); reject(new Error("Status-Zeitlimit überschritten.")); }, 15000);
    client.exec(command, (error, stream) => {
      if (error) { clearTimeout(timer); return reject(error); }
      let output = "";
      stream.on("data", (chunk) => { output += chunk.toString(); if (output.length > 32768) { clearTimeout(timer); stream.close(); reject(new Error("Statusausgabe zu groß.")); } });
      stream.stderr.on("data", () => {});
      stream.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`Statusbefehl fehlgeschlagen: ${code}`)); });
      stream.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
  });
}
async function status(client) { return execBounded(client, "hostname; uptime -p; df -h /; free -m"); }
export function parseMetrics(output) {
  const lines = output.trim().split("\n");
  const cpu = lines.filter((line) => line.startsWith("cpu ")).map((line) => line.trim().split(/\s+/).slice(1, 9).map(Number));
  const memory = /^MEM (\d+) (\d+)$/m.exec(output); const disk = /^DISK (\d+) (\d+)$/m.exec(output);
  if (cpu.length !== 2 || cpu.some((c) => c.length < 4 || c.some((v) => !Number.isFinite(v))) || !memory || !disk) throw new Error("Metriken nicht verfügbar (Linux /proc, awk und df erforderlich).");
  const total = (c) => c.reduce((a, b) => a + b, 0);
  const delta = total(cpu[1]) - total(cpu[0]); const idle = cpu[1][3] + (cpu[1][4] || 0) - cpu[0][3] - (cpu[0][4] || 0);
  const memoryTotal = Number(memory[1]) * 1024, memoryUsed = (Number(memory[1]) - Number(memory[2])) * 1024;
  const diskTotal = Number(disk[1]) * 1024, diskUsed = Number(disk[2]) * 1024;
  if (delta <= 0 || memoryTotal <= 0 || diskTotal <= 0 || memoryUsed < 0 || memoryUsed > memoryTotal || diskUsed < 0 || diskUsed > diskTotal || ![memoryTotal, memoryUsed, diskTotal, diskUsed].every(Number.isSafeInteger)) throw new Error("Ungültige Metriken.");
  return { cpuPercent: Math.max(0, Math.min(100, (1 - idle / delta) * 100)), memoryTotal, memoryUsed, memoryPercent: memoryUsed / memoryTotal * 100, diskTotal, diskUsed, diskPercent: diskUsed / diskTotal * 100, checkedAt: new Date().toISOString() };
}
async function metrics(client) {
  const command = `LC_ALL=C; export LC_ALL; head -n 1 /proc/stat; sleep 1; head -n 1 /proc/stat; awk '/MemTotal:/ {t=$2} /MemAvailable:/ {a=$2} END {print "MEM " t " " a}' /proc/meminfo; df -Pk / | awk 'NR==2 {print "DISK " $2 " " $3}'`;
  return parseMetrics(await execBounded(client, command));
}

export async function handleHostRequest(req, res, url, hosts, bodyBuffer, json) {
  if (url.pathname === "/api/hosts" && req.method === "GET") {
    return json(res, 200, hosts.map(({ id, label }) => ({ id, label })));
  }
  const match = /^\/api\/hosts\/([a-z0-9_-]+)\/(status|metrics|files|download|upload)$/.exec(url.pathname);
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
      if (action === "metrics") return await metrics(client);
      const sftp = await getSftp(client);
      const relative = url.searchParams.get("path") || "";
      if (action === "files") {
        const path = await allowedPath(sftp, host, relative);
        const files = await call(sftp, "readdir", path);
        return files.map((file) => ({ name: file.filename, directory: file.attrs.isDirectory(), size: file.attrs.size }));
      }
      if (action === "download") {
        const path = await allowedPath(sftp, host, relative);
        const handle = await call(sftp, "open", path, "r");
        let data;
        try {
          const attrs = await call(sftp, "fstat", handle);
          if (!attrs.isFile()) throw Object.assign(new Error("Keine Datei."), { status: 400 });
          if (attrs.size > MAX_FILE_BYTES) throw Object.assign(new Error("Datei zu groß."), { status: 413 });
          const chunks = []; let position = 0; const buffer = Buffer.alloc(65536);
          for (;;) {
            const size = Math.min(buffer.length, MAX_FILE_BYTES + 1 - position);
            const bytesRead = await call(sftp, "read", handle, buffer, 0, size, position);
            if (!bytesRead) break;
            position += bytesRead;
            if (position > MAX_FILE_BYTES) throw Object.assign(new Error("Datei zu groß."), { status: 413 });
            chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
          }
          data = Buffer.concat(chunks);
        } finally { await call(sftp, "close", handle); }
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

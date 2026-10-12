import {
  connectDrive, downloadDriveSnapshot, downloadHostFile, driveConnected, getHostStatus, getHosts,
  getHostMetrics, getServerVault, listDriveSnapshots, listHostFiles, putServerVault, serverLogin, serverLogout, serverSession,
  uploadDriveSnapshot, uploadHostFile, type DriveSnapshot, type HostInfo, type RemoteFile
} from "./remote";
import { assertVaultEpoch, vaultEpoch, vaultSignal, onVaultEnd } from "./lifecycle";
import { disconnectDrive } from "./remote";
import { withVaultLock } from "./storage";
import { hasDrafts } from "./drafts";
import type { ViewContext } from "./features";
import { saveBackup } from "./backups";
import { renderConflictResolver } from "./sync-conflicts";
import { decryptVaultWithKey, parseEnvelope, type VaultData, type VaultEnvelope } from "./vault";

export interface ConnectContext extends ViewContext {
  envelope: VaultEnvelope;
  replaceVault: (envelope: VaultEnvelope, passphrase: string) => Promise<void>;
  navigate: (tab: "sync" | "servers") => void;
}

let serverAuthenticated = false;
const REVISION_KEY = "allinone.serverRevision.v1";
const BASE_KEY = "allinone.serverBase.v1";
const GENERATION_KEY = "allinone.serverGeneration.v1";
export function getServerSyncGeneration(): string { return localStorage.getItem(GENERATION_KEY) || ""; }
let syncMessage = "";
let uploadTimer = 0;
let syncQueue = Promise.resolve();
let syncEpoch = 0;
let snapshots: DriveSnapshot[] = [];
let hosts: HostInfo[] = [];
let selectedHost = "";
let currentPath = "";
let files: RemoteFile[] = [];
let statusOutput = "";
let sessionChecked = false;

function checkSession(ctx: ConnectContext): void {
  if (sessionChecked) return;
  sessionChecked = true;
  serverSession(ctx.signal).then((active) => { if (ctx.isActive()) { serverAuthenticated = active; if (active && !hasDrafts()) ctx.render(); } }).catch(() => { sessionChecked = false; });
}

function message(error: unknown): string { return error instanceof Error ? error.message : "Vorgang fehlgeschlagen."; }

async function envelopeHash(envelope: VaultEnvelope): Promise<string> {
  const bytes = new TextEncoder().encode(`${envelope.kdf.salt}:${envelope.cipher.iv}:${envelope.cipher.data}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function runServerSync<T>(operation: () => Promise<T>): Promise<T> {
  const next = syncQueue.then(async () => await navigator.locks.request("allinone-server-sync", operation));
  syncQueue = next.then(() => undefined, () => undefined);
  return next;
}
async function setServerBaseline(revision: string | null, envelope: VaultEnvelope, generation = getServerSyncGeneration()): Promise<void> {
  const expectedEpoch = vaultEpoch(), expectedSync = syncEpoch;
  const hash = await envelopeHash(envelope);
  await withVaultLock(() => {
    assertVaultEpoch(expectedEpoch);
    if (syncEpoch !== expectedSync || getServerSyncGeneration() !== generation) throw new Error("Synchronisation zwischenzeitlich zurückgesetzt.");
    const raw = localStorage.getItem("allinone.vault.v1");
    if (!raw || parseEnvelope(raw).kdf.salt !== envelope.kdf.salt) throw new Error("Der lokale Tresor wurde gewechselt. Bitte erneut koppeln.");
    if (revision) localStorage.setItem(REVISION_KEY, revision); else localStorage.removeItem(REVISION_KEY);
    localStorage.setItem(BASE_KEY, hash); syncMessage = "Mit eigenem Server synchronisiert.";
  });
}
export function clearServerBaseline(): void {
  syncEpoch++; window.clearTimeout(uploadTimer);
  localStorage.setItem(GENERATION_KEY, crypto.randomUUID());
  syncMessage = "Lokal gespeichert";
  localStorage.removeItem(REVISION_KEY); localStorage.removeItem(BASE_KEY);
}
async function uploadCurrent(): Promise<void> {
  const expectedEpoch = vaultEpoch(), expectedSync = syncEpoch, generation = getServerSyncGeneration();
  const revision = localStorage.getItem(REVISION_KEY);
  if (!serverAuthenticated || !revision) return;
  const raw = localStorage.getItem("allinone.vault.v1"); if (!raw) return;
  const envelope = parseEnvelope(raw); const hash = await envelopeHash(envelope);
  if (hash === localStorage.getItem(BASE_KEY)) return;
  try {
    const nextRevision = await putServerVault(revision, envelope, vaultSignal());
    assertVaultEpoch(expectedEpoch); if (syncEpoch !== expectedSync) return;
    await setServerBaseline(nextRevision, envelope, generation);
    const latest = localStorage.getItem("allinone.vault.v1");
    if (latest && await envelopeHash(parseEnvelope(latest)) !== hash) scheduleServerSync();
  } catch (error) { if (vaultEpoch() === expectedEpoch && syncEpoch === expectedSync) syncMessage = `Automatische Synchronisation pausiert: ${message(error)}`; }
}
export function scheduleServerSync(): void {
  if (!serverAuthenticated || !localStorage.getItem(REVISION_KEY)) return;
  window.clearTimeout(uploadTimer);
  uploadTimer = window.setTimeout(() => { void runServerSync(uploadCurrent).catch((error) => { syncMessage = message(error); }); }, 2500);
}
export async function pollServerSync(envelope: VaultEnvelope, key: CryptoKey, replace: (remote: VaultEnvelope, data: VaultData) => Promise<boolean>): Promise<void> {
  const expectedEpoch = vaultEpoch(), expectedSync = syncEpoch, generation = getServerSyncGeneration();
  if (!localStorage.getItem(REVISION_KEY)) return;
  await runServerSync(async () => {
    try {
      assertVaultEpoch(expectedEpoch); if (syncEpoch !== expectedSync) return;
      serverAuthenticated = await serverSession(vaultSignal());
      if (!serverAuthenticated) { syncMessage = "Server-Anmeldung abgelaufen. Bitte erneut verbinden."; sessionChecked = false; return; }
      if (await envelopeHash(envelope) !== localStorage.getItem(BASE_KEY)) { scheduleServerSync(); return; }
      const remote = await getServerVault(vaultSignal());
      if (remote.revision === localStorage.getItem(REVISION_KEY) || !remote.envelope) return;
      const data = await decryptVaultWithKey(remote.envelope, key, envelope.kdf.salt);
      assertVaultEpoch(expectedEpoch); if (syncEpoch !== expectedSync) return;
      if (await replace(remote.envelope, data)) await setServerBaseline(remote.revision, remote.envelope, generation);
      else syncMessage = "Lokale Änderungen erkannt. Bitte Synchronisationskonflikt prüfen.";
    } catch (error) { if (vaultEpoch() === expectedEpoch && syncEpoch === expectedSync) syncMessage = `Automatische Synchronisation pausiert: ${message(error)}`; }
  });
}
function registerSessionCleanup(): void {
  onVaultEnd(() => {
    syncEpoch++; window.clearTimeout(uploadTimer); disconnectDrive();
    snapshots = []; hosts = []; selectedHost = ""; currentPath = ""; files = []; statusOutput = "";
    sessionChecked = false; registerSessionCleanup();
  });
}
registerSessionCleanup();

export function renderSync(ctx: ConnectContext): void {
  checkSession(ctx);
  const { content, element, heading } = ctx;
  content.append(heading("SYNCHRONISATION", "Deine Daten auf allen Geräten.", "Nur verschlüsselte Tresordaten verlassen dieses Gerät."));
  const server = element("section", "panel");
  server.append(element("h2", "", "Eigener Server"));
  server.append(element("p", "muted", "Der AllINONE-Dienst läuft auf deinem VPS. Zugang und Daten bleiben unter deiner Kontrolle."));
  const feedback = element("p", "message", "");
  if (syncMessage) server.append(element("p", syncMessage.includes("pausiert") ? "security-notice" : "positive", syncMessage));
  if (!serverAuthenticated) {
    const form = element("form");
    form.innerHTML = '<label for="server-password">Server-Passphrase</label><input id="server-password" type="password" autocomplete="current-password" required /><button class="primary form-submit" type="submit">Server verbinden</button>';
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await serverLogin(form.querySelector<HTMLInputElement>("input")!.value, ctx.signal);
        if (!ctx.isActive()) return;
        serverAuthenticated = true;
        ctx.render();
      } catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
    });
    server.append(form);
  } else {
    server.append(element("p", "positive", "Server-Sitzung aktiv"));
    const passLabel = element("label", "", "Tresor-Passphrase für das Herunterladen");
    passLabel.htmlFor = "remote-passphrase";
    const passInput = element("input") as HTMLInputElement;
    passInput.id = "remote-passphrase";
    passInput.type = "password";
    passInput.autocomplete = "off";
    const actions = element("div", "button-row wrap");
    const push = element("button", "primary", "Verschlüsselten Tresor hochladen");
    push.addEventListener("click", async () => {
      push.disabled = true;
      const generation = getServerSyncGeneration();
      try {
        await runServerSync(async () => {
          if (!ctx.isActive()) throw new Error("Ansicht geändert. Bitte erneut versuchen.");
          let revision = localStorage.getItem(REVISION_KEY);
          if (!revision) { const remote = await getServerVault(ctx.signal); if (remote.revision) throw new Error("Auf dem Server liegt bereits ein Tresor. Lade ihn zuerst herunter, um Überschreiben zu verhindern."); }
          const envelope = parseEnvelope(localStorage.getItem("allinone.vault.v1")!);
          const nextRevision = await putServerVault(revision, envelope, ctx.signal);
          if (!ctx.isActive()) return;
          await setServerBaseline(nextRevision, envelope, generation);
          feedback.textContent = "Verschlüsselter Tresor auf dem Server gespeichert."; feedback.className = "message";
        });
      } catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
      finally { push.disabled = false; }
    });
    const pull = element("button", "outline-button", "Vom Server herunterladen");
    pull.addEventListener("click", async () => {
      const passphrase = passInput.value; pull.disabled = true;
      try {
        if (!passphrase) throw new Error("Gib die Passphrase des entfernten Tresors ein.");
        await runServerSync(async () => {
          if (!ctx.isActive()) throw new Error("Ansicht geändert. Bitte erneut versuchen.");
          const remote = await getServerVault(ctx.signal);
          if (!remote.envelope) throw new Error("Auf dem Server liegt noch kein Tresor.");
          if (!ctx.isActive() || !window.confirm("Lokale Daten durch den Server-Tresor ersetzen? Exportiere vorher eine Sicherung, falls du lokale Änderungen behalten möchtest.")) return;
          await ctx.replaceVault(remote.envelope, passphrase);
          await setServerBaseline(remote.revision, remote.envelope);
        });
      } catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
      finally { pull.disabled = false; }
    });
    const logout = element("button", "outline-button", "Server abmelden");
    logout.addEventListener("click", async () => { try { await runServerSync(() => serverLogout(ctx.signal)); syncEpoch++; window.clearTimeout(uploadTimer); serverAuthenticated = false; syncMessage = "Server abgemeldet · lokal gespeichert"; ctx.render(); } catch (error) { feedback.textContent = message(error); } });
    actions.append(push, pull, logout);
    const resolve = element("button", "outline-button", "Versionen vergleichen / Konflikt lösen");
    resolve.onclick = () => { const generation = getServerSyncGeneration(); void renderConflictResolver(ctx, passInput.value, async (revision, envelope) => { await setServerBaseline(revision, envelope, generation); }); };
    actions.append(resolve);
    server.append(passLabel, passInput, actions);
  }
  server.append(feedback);
  content.append(server);

  const drive = element("section", "panel");
  drive.append(element("h2", "", "Google Drive"));
  drive.append(element("p", "muted", "Speichert verschlüsselte Versionen im versteckten App-Datenbereich deines Google Drive. Verschiedene Geräte müssen die gewünschte Version bewusst laden; parallele Änderungen werden nicht automatisch zusammengeführt."));
  const driveFeedback = element("p", "message", "");
  const clientId = localStorage.getItem("allinone.googleClientId") || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
  if (!clientId) {
    drive.append(element("p", "security-notice", "Für Google Drive brauchst du eine öffentliche OAuth Client-ID aus der Google Cloud Console. Hinterlege keine Client-Secret-Werte im Browser."));
    const form = element("form");
    form.innerHTML = '<label for="google-client-id">Google OAuth Client-ID</label><input id="google-client-id" placeholder="...apps.googleusercontent.com" required /><button class="primary form-submit" type="submit">Client-ID speichern</button>';
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = form.querySelector<HTMLInputElement>("input")!.value.trim();
      if (!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) {
        driveFeedback.textContent = "Ungültige Google OAuth Client-ID.";
        driveFeedback.className = "message error";
        return;
      }
      localStorage.setItem("allinone.googleClientId", value);
      ctx.render();
    });
    drive.append(form);
  } else if (!driveConnected()) {
    const connect = element("button", "primary", "Google Drive verbinden");
    connect.addEventListener("click", async () => {
      try { await connectDrive(clientId, ctx.signal); if (!ctx.isActive()) { disconnectDrive(); return; } snapshots = await listDriveSnapshots(ctx.signal); ctx.render(); }
      catch (error) { driveFeedback.textContent = message(error); driveFeedback.className = "message error"; }
    });
    drive.append(connect);
  } else {
    const refresh = element("button", "outline-button", "Versionen aktualisieren");
    refresh.addEventListener("click", async () => { try { snapshots = await listDriveSnapshots(ctx.signal); ctx.render(); } catch (error) { driveFeedback.textContent = message(error); } });
    const upload = element("button", "primary", "Verschlüsselte Version hochladen");
    upload.addEventListener("click", async () => {
      try { await uploadDriveSnapshot(ctx.envelope, ctx.signal); snapshots = await listDriveSnapshots(ctx.signal); ctx.render(); }
      catch (error) { driveFeedback.textContent = message(error); driveFeedback.className = "message error"; }
    });
    const actions = element("div", "button-row wrap"); actions.append(upload, refresh); drive.append(actions);
    const passLabel = element("label", "", "Passphrase für heruntergeladene Version"); passLabel.htmlFor = "drive-passphrase";
    const passInput = element("input") as HTMLInputElement;
    passInput.id = "drive-passphrase"; passInput.type = "password"; passInput.autocomplete = "off";
    drive.append(passLabel, passInput);
    for (const snapshot of snapshots) {
      const row = element("div", "finance-row");
      row.append(element("span", "", new Date(snapshot.modifiedTime).toLocaleString("de-DE")));
      const restore = element("button", "outline-button", "Diese Version laden");
      restore.addEventListener("click", async () => {
        try {
          if (!passInput.value) throw new Error("Gib die Passphrase der Version ein.");
          const passphrase = passInput.value;
          const envelope = await downloadDriveSnapshot(snapshot.id, ctx.signal);
          if (!ctx.isActive()) return;
          if (!window.confirm("Lokale Daten durch diese Drive-Version ersetzen? Sichere lokale Änderungen vorher.")) return;
          await ctx.replaceVault(envelope, passphrase);
          clearServerBaseline();
        } catch (error) { driveFeedback.textContent = message(error); driveFeedback.className = "message error"; }
      });
      row.append(restore); drive.append(row);
    }
    if (!snapshots.length) drive.append(element("p", "empty", "Noch keine Drive-Version vorhanden."));
  }
  drive.append(driveFeedback);
  content.append(drive);
}

export function renderServers(ctx: ConnectContext): void {
  checkSession(ctx);
  const { content, element, heading } = ctx;
  content.append(heading("VPS-VERWALTUNG", "Deine Server im Blick.", "Status, Dateiliste und Übertragung über den eigenen Dienst."));
  if (!serverAuthenticated) {
    const panel = element("section", "panel");
    panel.append(element("p", "muted", "Verbinde zuerst den eigenen Server im Bereich Synchronisation."));
    const button = element("button", "primary", "Zur Synchronisation");
    button.addEventListener("click", () => ctx.navigate("sync"));
    panel.append(button); content.append(panel); return;
  }
  const panel = element("section", "panel");
  const feedback = element("p", "message", "");
  const refresh = element("button", "outline-button", "Hostliste laden");
  refresh.addEventListener("click", async () => {
    try { const loaded = await getHosts(ctx.signal); if (!ctx.isActive()) return; hosts = loaded; selectedHost = hosts[0]?.id || ""; files = []; statusOutput = ""; ctx.render(); }
    catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
  });
  panel.append(element("h2", "", "Freigegebene Hosts"), refresh);
  if (!hosts.length) panel.append(element("p", "empty", "Noch kein Host geladen oder in der Serverkonfiguration freigegeben."));
  else {
    const select = element("select") as HTMLSelectElement;
    select.setAttribute("aria-label", "VPS auswählen");
    for (const host of hosts) select.add(new Option(host.label, host.id));
    select.value = selectedHost;
    select.addEventListener("change", () => { selectedHost = select.value; files = []; statusOutput = ""; currentPath = ""; ctx.render(); });
    panel.append(select);
    const statusButton = element("button", "outline-button", "Status abrufen");
    statusButton.addEventListener("click", async () => {
      try { const output = (await getHostStatus(selectedHost, ctx.signal)).output; if (!ctx.isActive()) return; statusOutput = output; ctx.render(); }
      catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
    });
    panel.append(statusButton);
    if (statusOutput) panel.append(element("pre", "server-output", statusOutput));
    const monitor = element("section", "monitor"); monitor.append(element("h3", "", "Live-Monitoring"));
    const metrics = element("div"); monitor.append(metrics); panel.append(monitor);
    const hostId = selectedHost;
    let wasWarning = false;
    let monitorTimer = 0;
    ctx.signal.addEventListener("abort", () => window.clearTimeout(monitorTimer), { once: true });
    const check = async () => {
      if (!panel.isConnected) return;
      try {
        const m = await getHostMetrics(hostId, ctx.signal); metrics.className = ""; if (!panel.isConnected) return;
        metrics.replaceChildren();
        for (const [label, value] of [["CPU", m.cpuPercent], ["RAM", m.memoryPercent], ["Speicher /", m.diskPercent]] as const) { const row = element("div", "budget-row"); row.append(element("strong", value >= 90 ? "negative" : "", `${label}: ${value.toFixed(1)} %`)); const bar = element("progress"); bar.max = 100; bar.value = value; bar.setAttribute("aria-label", label); row.append(bar); metrics.append(row); }
        const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
        metrics.append(element("p", "hint", `RAM ${gib(m.memoryUsed)} / ${gib(m.memoryTotal)} GiB · Speicher ${gib(m.diskUsed)} / ${gib(m.diskTotal)} GiB · Geprüft ${new Date(m.checkedAt).toLocaleTimeString("de-DE")}`));
        const warning = m.cpuPercent >= 90 || m.memoryPercent >= 90 || m.diskPercent >= 90;
        if (warning) metrics.append(element("p", "security-notice", "Hohe Auslastung: Mindestens ein Wert erreicht 90 %."));
        if (warning && !wasWarning) notifyHost(`${hosts.find((h) => h.id === hostId)?.label || hostId}: hohe Auslastung`); wasWarning = warning;
      } catch (e) { if (panel.isConnected) { metrics.textContent = `VPS nicht erreichbar oder Monitoring nicht verfügbar: ${message(e)}`; metrics.className = "message error"; if (!wasWarning) notifyHost(`${hostId}: Verbindung fehlgeschlagen`); wasWarning = true; } }
      if (panel.isConnected) monitorTimer = window.setTimeout(check, 60_000);
    };
    const notifyHost = (body: string) => { if (ctx.data.preferences?.notifications && "Notification" in window && Notification.permission === "granted") void navigator.serviceWorker.ready.then((r) => { if (ctx.isActive()) return r.showNotification("AllINONE · VPS", { body, tag: `vps-${hostId}` }); }).catch(() => undefined); };
    monitorTimer = window.setTimeout(check, 0);
    monitor.append(element("p", "hint", "Aktualisiert jede Minute, solange diese VPS-Ansicht geöffnet und entsperrt ist. Linux-Hosts erforderlich. Verbindungen sind serverseitig gespeichert."));
    const pathLabel = element("label", "", "Pfad innerhalb des freigegebenen Verzeichnisses");
    pathLabel.htmlFor = "server-path";
    const pathInput = element("input") as HTMLInputElement;
    pathInput.id = "server-path"; pathInput.value = currentPath; pathInput.placeholder = "z. B. backups";
    const list = element("button", "outline-button", "Dateien anzeigen");
    const load = async (path: string) => {
      try { const loaded = await listHostFiles(selectedHost, path, ctx.signal); if (!ctx.isActive()) return; files = loaded; currentPath = path; ctx.render(); }
      catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
    };
    list.addEventListener("click", () => load(pathInput.value));
    panel.append(pathLabel, pathInput, list);
    if (currentPath) {
      const up = element("button", "text-button", "↑ Übergeordnetes Verzeichnis");
      up.addEventListener("click", () => load(currentPath.split("/").slice(0, -1).join("/")));
      panel.append(up);
    }
    for (const file of files.filter((item) => item.name !== "." && item.name !== "..")) {
      const row = element("div", "finance-row");
      row.append(element("span", "", `${file.directory ? "📁" : "▤"} ${file.name}${file.directory ? "" : ` · ${file.size} Bytes`}`));
      const action = element("button", "text-button", file.directory ? "Öffnen" : "Herunterladen");
      action.addEventListener("click", async () => {
        const path = [currentPath, file.name].filter(Boolean).join("/");
        try { if (file.directory) await load(path); else await downloadHostFile(selectedHost, path, ctx.signal); }
        catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
      });
      row.append(action); panel.append(row);
    }
    const uploadLabel = element("label", "outline-button upload-label", "Datei hierher hochladen");
    const uploadInput = element("input") as HTMLInputElement;
    uploadInput.type = "file"; uploadInput.className = "visually-hidden";
    uploadInput.addEventListener("change", async () => {
      const file = uploadInput.files?.[0]; if (!file) return;
      try { await uploadHostFile(selectedHost, [currentPath, file.name].filter(Boolean).join("/"), file, ctx.signal); await load(currentPath); }
      catch (error) { feedback.textContent = message(error); feedback.className = "message error"; }
    });
    uploadLabel.append(uploadInput); panel.append(uploadLabel);
  }
  panel.append(feedback); content.append(panel);
}

export function getSyncStatus(): string {
  return syncMessage || (serverAuthenticated ? "Server verbunden · noch nicht gekoppelt" : "Lokal gespeichert");
}

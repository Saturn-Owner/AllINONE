import { parseEnvelope, type VaultEnvelope } from "./vault";

export interface RemoteVault { revision: string | null; envelope: VaultEnvelope | null }
export interface HostInfo { id: string; label: string }
export interface RemoteFile { name: string; directory: boolean; size: number }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const signal = AbortSignal.any([AbortSignal.timeout(35000), ...(init.signal ? [init.signal] : [])]);
  const response = await fetch(path, { credentials: "same-origin", ...init, signal });
  let value: { error?: string } & T;
  try { value = await response.json(); } catch { throw new Error("Der VPS-Dienst antwortet nicht."); }
  if (!response.ok) throw new Error(value?.error || `Serverfehler ${response.status}`);
  return value;
}

export async function serverSession(signal?: AbortSignal): Promise<boolean> {
  const result = await api<{ authenticated: boolean }>("/api/session", { signal });
  if (typeof result?.authenticated !== "boolean") throw new Error("Ungültige Serverantwort.");
  return result.authenticated;
}

export async function serverLogin(password: string, signal?: AbortSignal): Promise<void> {
  await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), signal });
}

export async function serverLogout(signal?: AbortSignal): Promise<void> {
  await api("/api/logout", { method: "POST", signal });
}

export async function getServerVault(signal?: AbortSignal): Promise<RemoteVault> {
  const result = await api<RemoteVault>("/api/sync", { signal });
  if (!result || (result.revision !== null && typeof result.revision !== "string") || (result.envelope === null && result.revision !== null)) throw new Error("Ungültige Serverantwort.");
  return { revision: result.revision, envelope: result.envelope ? parseEnvelope(JSON.stringify(result.envelope)) : null };
}

export async function putServerVault(revision: string | null, envelope: VaultEnvelope, signal?: AbortSignal): Promise<string> {
  const result = await api<{ revision: string }>("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, envelope }), signal });
  if (typeof result?.revision !== "string" || !result.revision) throw new Error("Ungültige Serverantwort.");
  return result.revision;
}

export function getHosts(signal?: AbortSignal): Promise<HostInfo[]> { return api<HostInfo[]>("/api/hosts", { signal }); }
export function getHostStatus(id: string, signal?: AbortSignal): Promise<{ output: string }> { return api(`/api/hosts/${encodeURIComponent(id)}/status`, { signal }); }
export function listHostFiles(id: string, path: string, signal?: AbortSignal): Promise<RemoteFile[]> {
  return api<RemoteFile[]>(`/api/hosts/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`, { signal });
}

export async function downloadHostFile(id: string, path: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}/download?path=${encodeURIComponent(path)}`, { credentials: "same-origin", signal: AbortSignal.any([AbortSignal.timeout(35000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error((await response.json()).error || "Download fehlgeschlagen.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").pop() || "datei";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uploadHostFile(id: string, path: string, file: File, signal?: AbortSignal): Promise<void> {
  if (file.size > 10_000_000) throw new Error("Datei zu groß (maximal 10 MB).");
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}/upload?path=${encodeURIComponent(path)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body: file, signal: AbortSignal.any([AbortSignal.timeout(35000), ...(signal ? [signal] : [])]) });
  if (!response.ok) throw new Error((await response.json()).error || "Upload fehlgeschlagen.");
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void; error_callback?: (error: { type?: string }) => void }) => { requestAccessToken: () => void } } } };
  }
}

let driveToken: string | null = null;

function loadGoogleScript(): Promise<void> {
  if (window.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google-Anmeldung konnte nicht geladen werden."));
    document.head.append(script);
  });
}

export async function connectDrive(clientId: string, signal?: AbortSignal): Promise<void> {
  if (!clientId) throw new Error("Google OAuth Client-ID fehlt in der Build-Konfiguration.");
  await loadGoogleScript();
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const cancel = () => reject(new DOMException("Google-Anmeldung abgebrochen.", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.appdata",
      error_callback: () => { signal?.removeEventListener("abort", cancel); reject(new Error("Das Google-Anmeldefenster wurde blockiert oder geschlossen. Bitte Pop-ups erlauben und erneut versuchen.")); },
      callback: (response) => {
        signal?.removeEventListener("abort", cancel);
        if (signal?.aborted) return cancel();
        if (response.error || !response.access_token) return reject(new Error(response.error || "Google-Anmeldung fehlgeschlagen."));
        driveToken = response.access_token;
        resolve();
      }
    });
    client.requestAccessToken();
  });
}

export function driveConnected(): boolean { return Boolean(driveToken); }

async function driveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!driveToken) throw new Error("Google Drive zuerst verbinden.");
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...init, signal: AbortSignal.any([AbortSignal.timeout(35000), ...(init.signal ? [init.signal] : [])]), headers: { authorization: `Bearer ${driveToken}`, ...init.headers }
  });
  if (!response.ok) {
    if (response.status === 401) driveToken = null;
    throw new Error(`Google Drive antwortet mit ${response.status}.`);
  }
  return response;
}

export interface DriveSnapshot { id: string; name: string; modifiedTime: string }

export async function listDriveSnapshots(signal?: AbortSignal): Promise<DriveSnapshot[]> {
  const query = new URLSearchParams({ spaces: "appDataFolder", q: "name contains 'allinone-vault-' and 'appDataFolder' in parents and trashed = false", fields: "files(id,name,modifiedTime),nextPageToken", pageSize: "100", orderBy: "modifiedTime desc" });
  const snapshots: DriveSnapshot[] = []; const pages = new Set<string>();
  for (;;) {
    const response = await driveFetch(`/drive/v3/files?${query}`, { signal });
    const data = await response.json() as { files?: DriveSnapshot[]; nextPageToken?: string };
    if (!data || (data.files !== undefined && !Array.isArray(data.files))) throw new Error("Ungültige Drive-Antwort.");
    snapshots.push(...(data.files || []));
    if (!data.nextPageToken) return snapshots;
    if (pages.has(data.nextPageToken) || pages.size >= 100) throw new Error("Die Drive-Versionsliste konnte nicht vollständig geladen werden.");
    pages.add(data.nextPageToken); query.set("pageToken", data.nextPageToken);
  }
}

export async function uploadDriveSnapshot(envelope: VaultEnvelope, signal?: AbortSignal): Promise<void> {
  const boundary = `allinone_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = JSON.stringify({ name: `allinone-vault-${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}.json`, parents: ["appDataFolder"], mimeType: "application/json" });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(envelope)}\r\n--${boundary}--`;
  await driveFetch("/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body, signal });
}

export async function downloadDriveSnapshot(id: string, signal?: AbortSignal): Promise<VaultEnvelope> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Ungültige Datei-ID.");
  const response = await driveFetch(`/drive/v3/files/${id}?alt=media`, { signal });
  return parseEnvelope(await response.text());
}

export interface HostMetrics { cpuPercent: number; memoryTotal: number; memoryUsed: number; memoryPercent: number; diskTotal: number; diskUsed: number; diskPercent: number; checkedAt: string }
export function getHostMetrics(id: string, signal?: AbortSignal): Promise<HostMetrics> { return api(`/api/hosts/${encodeURIComponent(id)}/metrics`, { signal }); }

export function disconnectDrive(): void { driveToken = null; }

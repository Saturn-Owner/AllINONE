import { parseEnvelope, type VaultEnvelope } from "./vault";

export interface RemoteVault { revision: string | null; envelope: VaultEnvelope | null }
export interface HostInfo { id: string; label: string }
export interface RemoteFile { name: string; directory: boolean; size: number }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  let value: { error?: string } & T;
  try { value = await response.json(); } catch { throw new Error("Der VPS-Dienst antwortet nicht."); }
  if (!response.ok) throw new Error(value.error || `Serverfehler ${response.status}`);
  return value;
}

export async function serverSession(): Promise<boolean> {
  const result = await api<{ authenticated: boolean }>("/api/session");
  return result.authenticated;
}

export async function serverLogin(password: string): Promise<void> {
  await api("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
}

export async function serverLogout(): Promise<void> {
  await api("/api/logout", { method: "POST" });
}

export async function getServerVault(): Promise<RemoteVault> {
  const result = await api<RemoteVault>("/api/sync");
  return { revision: result.revision, envelope: result.envelope ? parseEnvelope(JSON.stringify(result.envelope)) : null };
}

export async function putServerVault(revision: string | null, envelope: VaultEnvelope): Promise<string> {
  const result = await api<{ revision: string }>("/api/sync", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, envelope }) });
  return result.revision;
}

export function getHosts(): Promise<HostInfo[]> { return api<HostInfo[]>("/api/hosts"); }
export function getHostStatus(id: string): Promise<{ output: string }> { return api(`/api/hosts/${encodeURIComponent(id)}/status`); }
export function listHostFiles(id: string, path: string): Promise<RemoteFile[]> {
  return api<RemoteFile[]>(`/api/hosts/${encodeURIComponent(id)}/files?path=${encodeURIComponent(path)}`);
}

export async function downloadHostFile(id: string, path: string): Promise<void> {
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}/download?path=${encodeURIComponent(path)}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error((await response.json()).error || "Download fehlgeschlagen.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = path.split("/").pop() || "datei";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function uploadHostFile(id: string, path: string, file: File): Promise<void> {
  if (file.size > 10_000_000) throw new Error("Datei zu groß (maximal 10 MB).");
  const response = await fetch(`/api/hosts/${encodeURIComponent(id)}/upload?path=${encodeURIComponent(path)}`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/octet-stream" }, body: file });
  if (!response.ok) throw new Error((await response.json()).error || "Upload fehlgeschlagen.");
}

declare global {
  interface Window {
    google?: { accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }) => { requestAccessToken: () => void } } } };
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

export async function connectDrive(clientId: string): Promise<void> {
  if (!clientId) throw new Error("Google OAuth Client-ID fehlt in der Build-Konfiguration.");
  await loadGoogleScript();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.appdata",
      callback: (response) => {
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
    ...init, headers: { authorization: `Bearer ${driveToken}`, ...init.headers }
  });
  if (!response.ok) {
    if (response.status === 401) driveToken = null;
    throw new Error(`Google Drive antwortet mit ${response.status}.`);
  }
  return response;
}

export interface DriveSnapshot { id: string; name: string; modifiedTime: string }

export async function listDriveSnapshots(): Promise<DriveSnapshot[]> {
  const query = new URLSearchParams({ spaces: "appDataFolder", q: "name contains 'allinone-vault-' and 'appDataFolder' in parents and trashed = false", fields: "files(id,name,modifiedTime),nextPageToken", pageSize: "100", orderBy: "modifiedTime desc" });
  const response = await driveFetch(`/drive/v3/files?${query}`);
  const data = await response.json() as { files: DriveSnapshot[] };
  return data.files || [];
}

export async function uploadDriveSnapshot(envelope: VaultEnvelope): Promise<void> {
  const boundary = `allinone_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = JSON.stringify({ name: `allinone-vault-${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}.json`, parents: ["appDataFolder"], mimeType: "application/json" });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(envelope)}\r\n--${boundary}--`;
  await driveFetch("/upload/drive/v3/files?uploadType=multipart&fields=id", { method: "POST", headers: { "content-type": `multipart/related; boundary=${boundary}` }, body });
}

export async function downloadDriveSnapshot(id: string): Promise<VaultEnvelope> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Ungültige Datei-ID.");
  const response = await driveFetch(`/drive/v3/files/${id}?alt=media`);
  return parseEnvelope(await response.text());
}

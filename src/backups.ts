import { parseEnvelope } from "./vault";
export interface Backup { id: string; salt: string; createdAt: string; raw: string }
let database: Promise<IDBDatabase> | undefined;
export let backupError = "";
function db(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("allinone-backups", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }).catch((error) => { database = undefined; throw error; });
  return database!;
}
export async function listBackups(salt?: string): Promise<Backup[]> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("snapshots", "readonly"); const request = tx.objectStore("snapshots").getAll();
    request.onsuccess = () => resolve((request.result as Backup[]).filter((b) => !salt || b.salt === salt).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error);
  });
}
let queue = Promise.resolve();
export function saveBackup(raw: string): Promise<void> {
  const work = queue.then(async () => {
    // Preserve a damaged current file as an opaque copy, so recovery can replace it.
    let salt = "unbekannt";
    try { salt = parseEnvelope(raw).kdf.salt; } catch { /* raw copy remains downloadable */ }
    const database = await db();
    const existing = await listBackups(salt);
    if (existing[0]?.raw === raw) return;
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("snapshots", "readwrite"); const store = tx.objectStore("snapshots");
      store.put({ id: crypto.randomUUID(), salt, createdAt: new Date().toISOString(), raw });
      for (const old of existing.slice(19)) store.delete(old.id);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    }); backupError = "";
  });
  queue = work.catch((error) => { backupError = `Automatische Sicherung fehlgeschlagen: ${error instanceof Error ? error.message : "Speicher nicht verfügbar"}`; });
  return work;
}

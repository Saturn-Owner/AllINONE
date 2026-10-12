export interface VaultEnvelope {
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: 600000; salt: string };
  cipher: { name: "AES-GCM"; iv: string; data: string };
}
export function base64Bytes(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("Ungültige Sicherungsdatei.");
  const binary = atob(value);
  if (btoa(binary) !== value) throw new Error("Ungültige Sicherungsdatei.");
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export function parseEnvelope(raw: string): VaultEnvelope {
  if (raw.length > 10_000_000) throw new Error("Sicherung ist zu groß (maximal 10 MB).");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Ungültige Sicherungsdatei."); }
  if (!value || typeof value !== "object") throw new Error("Ungültige Sicherungsdatei.");
  const e = value as VaultEnvelope;
  if (e.version !== 1 || e.kdf?.name !== "PBKDF2" || e.kdf.hash !== "SHA-256" || e.kdf.iterations !== 600000 || e.cipher?.name !== "AES-GCM"
    || typeof e.kdf.salt !== "string" || typeof e.cipher.iv !== "string" || typeof e.cipher.data !== "string"
    || base64Bytes(e.kdf.salt).length !== 16 || base64Bytes(e.cipher.iv).length !== 12 || base64Bytes(e.cipher.data).length < 16) throw new Error("Unbekanntes oder beschädigtes Tresorformat.");
  return { version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt: e.kdf.salt }, cipher: { name: "AES-GCM", iv: e.cipher.iv, data: e.cipher.data } };
}

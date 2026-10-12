export const STORAGE_KEY = "allinone.vault.v1";
export async function withVaultLock<T>(operation: () => Promise<T> | T): Promise<T> {
  if (!navigator.locks) throw new Error("Dieser Browser unterstützt keine sicheren parallelen Tresorzugriffe. Bitte einen aktuellen Browser verwenden.");
  return navigator.locks.request("allinone-vault-write", operation);
}
export function assertStoredVault(expected: string | null): void {
  if (localStorage.getItem(STORAGE_KEY) !== expected) throw new Error("Der Tresor wurde in einem anderen Fenster geändert. Bitte erneut entsperren.");
}

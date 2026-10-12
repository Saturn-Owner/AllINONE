let epoch = 0;
let controller = new AbortController();
const cleanup = new Set<() => void>();
export function vaultEpoch(): number { return epoch; }
export function vaultSignal(): AbortSignal { return controller.signal; }
export function invalidateVault(): void {
  epoch++;
  controller.abort();
  controller = new AbortController();
  const disposers = [...cleanup]; cleanup.clear();
  for (const dispose of disposers) dispose();
}
export function assertVaultEpoch(expected: number): void {
  if (expected !== epoch) throw new Error("Der Tresor wurde zwischenzeitlich gesperrt oder gewechselt. Bitte erneut versuchen.");
}
export function onVaultEnd(dispose: () => void): void { cleanup.add(dispose); }

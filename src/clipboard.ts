async function digest(value: string): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).join(",");
}
export async function copyWithExpiry(secret: string, signal: AbortSignal, button: HTMLButtonElement): Promise<void> {
  const expected = await digest(secret); signal.throwIfAborted();
  await navigator.clipboard.writeText(secret); secret = "";
  const ref = new WeakRef(button);
  const clear = async () => {
    try { if (await digest(await navigator.clipboard.readText()) === expected) await navigator.clipboard.writeText(""); } catch { /* optional clipboard permission */ }
    const current = ref.deref(); if (current) current.textContent = "Kopieren";
  };
  if (signal.aborted) { await clear(); return; }
  button.textContent = "Kopiert";
  const timer = window.setTimeout(() => { void clear(); }, 30000);
  signal.addEventListener("abort", () => { window.clearTimeout(timer); void clear(); }, { once: true });
}

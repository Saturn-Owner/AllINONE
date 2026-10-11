export function fillCredentials(origin: string, username: string, password: string): number {
  if (location.origin !== origin || location.protocol !== "https:" || window.top !== window) return 0;
  const visible = (input: HTMLInputElement) => !input.disabled && !input.readOnly && input.getClientRects().length > 0 && getComputedStyle(input).visibility !== "hidden";
  const passwords = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter(visible);
  if (passwords.length !== 1 || passwords[0].autocomplete === "new-password") return 0;
  const secret = passwords[0]; const container = secret.form || document.body;
  const candidates = [...container.querySelectorAll<HTMLInputElement>('input[type="email"],input[type="text"],input:not([type])')].filter(visible);
  const user = candidates.find((i) => i.autocomplete === "username" || i.type === "email" || /user|login|email/i.test(i.name + i.id)) || candidates.filter((i) => Boolean(i.compareDocumentPosition(secret) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (const [input, value] of [[user, username], [secret, password]] as const) if (input) { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); }
  return user ? 2 : 1;
}

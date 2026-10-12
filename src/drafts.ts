type Field = { id: string; value: string; checked?: boolean };
type Draft = { key: string; fields: Field[] };
const dirty = new Set<string>();
let submitted: HTMLFormElement | null = null;
const key = (form: HTMLFormElement) => `${form.id}:${form.dataset.draftKey || ""}`;
document.addEventListener("input", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>(".workspace form[id]");
  if (form) dirty.add(key(form));
});
document.addEventListener("change", (event) => {
  const form = (event.target as HTMLElement).closest<HTMLFormElement>(".workspace form[id]");
  if (form) dirty.add(key(form));
});
document.addEventListener("submit", (event) => {
  submitted = event.target as HTMLFormElement;
  const current = submitted;
  window.setTimeout(() => { if (submitted === current) submitted = null; }, 0);
}, true);
export function currentSubmission(): HTMLFormElement | null { return submitted; }
export function clearFormDraft(form: HTMLFormElement | null): void { if (form) dirty.delete(key(form)); }
export function clearDrafts(): void { dirty.clear(); }
export function hasDrafts(): boolean { return dirty.size > 0; }
export function captureDrafts(root: HTMLElement): Draft[] {
  return [...root.querySelectorAll<HTMLFormElement>(".workspace form[id]")].filter((f) => dirty.has(key(f))).map((form) => ({ key: key(form), fields: [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[id]:not([type=file]),textarea[id],select[id]")].map((field) => ({ id: field.id, value: field.value, ...(field instanceof HTMLInputElement ? { checked: field.checked } : {}) })) }));
}
export function restoreDrafts(root: HTMLElement, drafts: Draft[]): void {
  dirty.clear();
  for (const form of root.querySelectorAll<HTMLFormElement>(".workspace form[id]")) {
    const draft = drafts.find((d) => d.key === key(form)); if (!draft) continue;
    for (const saved of draft.fields) {
      const field = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[id],textarea[id],select[id]")].find((f) => f.id === saved.id);
      if (!field) continue;
      field.value = saved.value;
      if (field instanceof HTMLInputElement && saved.checked !== undefined) field.checked = saved.checked;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    }
    dirty.add(key(form));
  }
}

export function hasFormDraft(form: HTMLFormElement): boolean { return dirty.has(key(form)); }

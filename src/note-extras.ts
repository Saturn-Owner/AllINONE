import type { Note, VaultData } from "./vault";
import { downloadFile } from "./productivity";
export const NOTE_TEMPLATES: Record<string, string> = {
  "Tagesnotiz": "# Mein Tag\n\n## Fokus\n- \n\n## Gedanken\n\n## Rückblick\n",
  "Projekt": "# Projekt\n\n## Ziel\n\n## Nächste Schritte\n- [ ] \n\n## Entscheidungen\n",
  "Besprechung": "# Besprechung\n\n## Teilnehmende\n\n## Themen\n\n## Ergebnisse\n\n## Aufgaben\n- [ ] \n"
};
export function rememberNote(note: Note): void {
  note.history = [{ title: note.title, body: note.body, updatedAt: note.updatedAt }, ...(note.history || [])].slice(0, 20);
}
export function appendNoteExtras(editor: HTMLElement, selected: Note | undefined, changeData: (f: (d: VaultData) => void) => Promise<void>): void {
  const form = editor.querySelector("form")!;
  const fields = document.createElement("div"); fields.className = "form-pair";
  fields.innerHTML = '<div><label for="note-folder">Ordner</label><input id="note-folder" maxlength="100" placeholder="z. B. Projekte/Webseite" /></div><div><label for="note-tags">Tags · mit Komma trennen</label><input id="note-tags" maxlength="500" placeholder="wissen, ideen" /></div>';
  fields.querySelector<HTMLInputElement>("#note-folder")!.value = selected?.folder || "";
  fields.querySelector<HTMLInputElement>("#note-tags")!.value = selected?.tags?.join(", ") || "";
  form.insertBefore(fields, form.querySelector(".button-row"));
  const template = document.createElement("select"); template.setAttribute("aria-label", "Notizvorlage"); template.add(new Option("Vorlage auswählen …", ""));
  Object.keys(NOTE_TEMPLATES).forEach((t) => template.add(new Option(t, t)));
  template.onchange = () => {
    if (!template.value) return;
    const input = editor.querySelector<HTMLTextAreaElement>("#note-body")!;
    if (input.value && !window.confirm("Aktuellen Entwurf durch die Vorlage ersetzen?")) return;
    input.value = NOTE_TEMPLATES[template.value]; input.dispatchEvent(new Event("input"));
  }; form.prepend(template);
  if (!selected) { const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = "Speichere die Notiz, um Anhänge hinzuzufügen."; editor.append(hint); return; }
  const attachments = document.createElement("section"); attachments.className = "note-attachments";
  const label = document.createElement("label"); label.className = "outline-button"; label.textContent = "Bild oder Anhang hinzufügen";
  const upload = document.createElement("input"); upload.type = "file"; upload.className = "visually-hidden";
  upload.onchange = async () => {
    const file = upload.files?.[0]; if (!file) return;
    try {
      if (file.size > 2_000_000 || (selected.attachments || []).reduce((sum, a) => sum + a.base64.length * 0.75, 0) + file.size > 3_000_000) throw new Error("Maximal 2 MB pro Datei und 3 MB Anhänge pro Notiz. Der Browser-Tresor hat begrenzten Speicher.");
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      await changeData((d) => { const note = d.notes.find((n) => n.id === selected.id); if (note) (note.attachments ||= []).push({ id: crypto.randomUUID(), name: file.name, mime: file.type || "application/octet-stream", base64: btoa(binary) }); });
    } catch (e) { window.alert(e instanceof Error ? e.message : "Anhang konnte nicht gespeichert werden."); }
  }; label.append(upload); attachments.append(label);
  for (const a of selected.attachments || []) {
    const row = document.createElement("div"); row.className = "attachment-row";
    if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(a.mime)) { const img = document.createElement("img"); img.src = `data:${a.mime};base64,${a.base64}`; img.alt = a.name; img.className = "attachment-image"; row.append(img); }
    const download = document.createElement("button"); download.className = "text-button"; download.textContent = `↓ ${a.name}`;
    download.onclick = () => downloadFile(a.name, Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0)), "application/octet-stream");
    const remove = document.createElement("button"); remove.className = "text-button danger"; remove.textContent = "Anhang entfernen";
    remove.onclick = () => { if (window.confirm(`Anhang „${a.name}“ entfernen?`)) void changeData((d) => { const n = d.notes.find((n) => n.id === selected.id); if (n) n.attachments = n.attachments?.filter((x) => x.id !== a.id); }).catch(() => window.alert("Speichern fehlgeschlagen.")); };
    row.append(download, remove); attachments.append(row);
  } editor.append(attachments);
  if (selected.history?.length) {
    const history = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = `Versionshistorie (${selected.history.length})`; history.append(summary);
    for (const version of selected.history) {
      const row = document.createElement("div"); row.className = "finance-row";
      const text = document.createElement("span"); text.textContent = `${new Date(version.updatedAt).toLocaleString("de-DE")} · ${version.title}`;
      const button = document.createElement("button"); button.className = "outline-button"; button.textContent = "Version wiederherstellen";
      button.onclick = () => {
        if (!window.confirm("Titel und Inhalt durch diese Version ersetzen? Der aktuelle Stand bleibt in der Historie.")) return;
        void changeData((d) => { const n = d.notes.find((n) => n.id === selected.id); if (n) { rememberNote(n); n.title = version.title; n.body = version.body; n.updatedAt = new Date().toISOString(); } }).catch(() => window.alert("Wiederherstellung fehlgeschlagen."));
      }; row.append(text, button); history.append(row);
    } editor.append(history);
  }
}

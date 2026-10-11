import "./style.css";
import {
  createVault, encryptVault, parseEnvelope, unlockVault,
  type Note, type Priority, type Task, type VaultData, type VaultEnvelope
} from "./vault";
import { balance, formatEuro } from "./domain";
import { wikiLinks } from "./domain";
import { renderFinances, renderPasswords, type ViewContext } from "./features";
import { clearServerBaseline, pollServerSync, renderServers, renderSync, scheduleServerSync, type ConnectContext } from "./connect";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { strToU8, zipSync } from "fflate";

const STORAGE_KEY = "allinone.vault.v1";
const app = document.querySelector<HTMLDivElement>("#app")!;
type Tab = "dashboard" | "tasks" | "notes" | "passwords" | "finances" | "servers" | "sync";

let session: { data: VaultData; key: CryptoKey; envelope: VaultEnvelope } | null = null;
let tab: Tab = "dashboard";
let editingNote: string | null = null;
let lastActivity = Date.now();
let changeQueue = Promise.resolve();
let pendingChanges = 0;

for (const eventName of ["pointerdown", "keydown"]) {
  window.addEventListener(eventName, () => { lastActivity = Date.now(); }, { passive: true });
}
window.setInterval(() => {
  if (session && Date.now() - lastActivity > 15 * 60 * 1000) {
    session = null;
    tab = "dashboard";
    render();
  }
}, 30_000);

function pollNow(): void {
  const active = session;
  if (!active || pendingChanges) return;
  void pollServerSync(active.envelope, active.key, (envelope, data) => {
    if (!session || session.envelope.cipher.data !== active.envelope.cipher.data) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    session = { ...session, data, envelope };
    render();
    return true;
  });
}

window.setInterval(pollNow, 30_000);
window.addEventListener("focus", pollNow);
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY && session && event.newValue !== JSON.stringify(session.envelope)) {
    session = null;
    render();
  }
});

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, value?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function announce(message: string, error = false): void {
  const box = document.querySelector<HTMLDivElement>("#message");
  if (!box) return;
  box.textContent = message;
  box.className = error ? "message error" : "message";
}

function storedEnvelope(): VaultEnvelope | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? parseEnvelope(raw) : null;
}

async function changeData(update: (data: VaultData) => void): Promise<void> {
  pendingChanges++;
  const pending = changeQueue.then(async () => {
    const active = session;
    if (!active) return;
    const next = structuredClone(active.data);
    update(next);
    const envelope = await encryptVault(next, active.key, active.envelope.kdf.salt);
    if (session !== active) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    session = { ...active, data: next, envelope };
    render();
    scheduleServerSync();
  });
  changeQueue = pending.catch(() => undefined);
  try { await pending; } finally { pendingChanges--; }
}

function renderGate(): void {
  const hasVault = localStorage.getItem(STORAGE_KEY) !== null;
  app.innerHTML = `
    <main class="gate">
      <div class="gate-brand"><span class="brand-mark">A</span><span>AllINONE</span></div>
      <div class="gate-grid">
        <section class="gate-intro">
          <span class="eyebrow">DEIN RAUM FÜR KLARE GEDANKEN</span>
          <h1>Alles Wichtige.<br><em>An einem Ort.</em></h1>
          <p>Aufgaben, Wissen, Zugänge und Finanzen an einem Ort. Deine Daten liegen zuerst verschlüsselt auf deinem Gerät.</p>
          <div class="intro-points"><span>◈ Lokal nutzbar</span><span>◈ Verschlüsselter Tresor</span><span>◈ Installierbar</span></div>
        </section>
        <section class="gate-card">
          <div class="card-icon">✦</div>
          <h2>${hasVault ? "Willkommen zurück" : "Deinen Raum einrichten"}</h2>
          <p>${hasVault ? "Entsperre deinen lokalen Tresor." : "Erstelle eine Passphrase mit mindestens 14 Zeichen. Sie kann nicht wiederhergestellt werden."}</p>
          <form id="vault-form">
            <label for="passphrase">Passphrase</label>
            <input id="passphrase" type="password" autocomplete="${hasVault ? "current-password" : "new-password"}" minlength="${hasVault ? 1 : 14}" required />
            ${hasVault ? "" : '<label for="confirm">Passphrase wiederholen</label><input id="confirm" type="password" autocomplete="new-password" minlength="14" required />'}
            <button class="primary full" type="submit">${hasVault ? "Tresor entsperren" : "Tresor erstellen"}<span aria-hidden="true">→</span></button>
          </form>
          <div id="message" class="message" role="status" aria-live="polite"></div>
          <div class="gate-divider">oder</div>
          <label class="import-label" for="import-file">Verschlüsselte Sicherung importieren</label>
          <input id="import-file" class="visually-hidden" type="file" accept="application/json,.json" />
          <p class="tiny">Ohne deine Passphrase ist eine Sicherung nicht lesbar. Exportiere regelmäßig eine Kopie.</p>
        </section>
      </div>
    </main>`;

  document.querySelector<HTMLFormElement>("#vault-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passphrase = document.querySelector<HTMLInputElement>("#passphrase")!.value;
    const button = document.querySelector<HTMLButtonElement>("#vault-form button")!;
    button.disabled = true;
    try {
      if (hasVault) {
        const envelope = storedEnvelope()!;
        const { data, key } = await unlockVault(envelope, passphrase);
        session = { data, key, envelope };
      } else {
        if (passphrase !== document.querySelector<HTMLInputElement>("#confirm")!.value) {
          throw new Error("Die Passphrasen stimmen nicht überein.");
        }
        const created = await createVault(passphrase);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(created.envelope));
        clearServerBaseline();
        session = created;
      }
      render();
      pollNow();
    } catch (error) {
      announce(error instanceof Error ? error.message : "Tresor konnte nicht geöffnet werden.", true);
      button.disabled = false;
    }
  });

  document.querySelector<HTMLInputElement>("#import-file")!.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("Sicherung ist zu groß (maximal 10 MB).");
      const passphrase = document.querySelector<HTMLInputElement>("#passphrase")!.value;
      if (!passphrase) throw new Error("Gib zuerst die Passphrase der Sicherung ein.");
      const envelope = parseEnvelope(await file.text());
      const { data, key } = await unlockVault(envelope, passphrase);
      if (hasVault && !window.confirm("Den bestehenden lokalen Tresor durch diese Sicherung ersetzen?")) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      clearServerBaseline();
      session = { data, key, envelope };
      render();
    } catch (error) {
      announce(error instanceof Error ? error.message : "Import fehlgeschlagen.", true);
    }
  });
}

function renderShell(): void {
  app.innerHTML = `
    <div class="workspace">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">A</span><span>AllINONE<small>DEIN DIGITALER RAUM</small></span></div>
        <div class="nav-label">WORKSPACE</div>
        <nav aria-label="Hauptnavigation">
          <button data-tab="dashboard"><span>▦</span> Übersicht</button>
          <button data-tab="tasks"><span>✓</span> Aufgaben</button>
          <button data-tab="notes"><span>▤</span> Notizen</button>
          <button data-tab="passwords"><span>⌘</span> Passwörter</button>
          <button data-tab="finances"><span>◈</span> Finanzen</button>
        </nav>
        <div class="nav-label later">VERBINDEN</div>
        <nav aria-label="Verbindungen"><button data-tab="sync"><span>↗</span> Synchronisation</button><button data-tab="servers"><span>▣</span> VPS</button></nav>
        <div class="sidebar-bottom"><div class="local-badge"><span class="status-dot"></span> Lokal & verschlüsselt</div><button id="lock-button" class="text-button">⇥ Tresor sperren</button></div>
      </aside>
      <div class="main-column">
        <header class="topbar"><span>Dein persönlicher Workspace</span><div><button id="mobile-lock" class="outline-button">Sperren</button> <button id="export-button" class="outline-button">↓ Sicherung exportieren</button></div></header>
        <main id="content" class="content"></main>
      </div>
    </div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
    button.addEventListener("click", () => { tab = button.dataset.tab as Tab; editingNote = null; render(); });
  });
  const lock = () => {
    session = null;
    tab = "dashboard";
    render();
  };
  document.querySelector<HTMLButtonElement>("#lock-button")!.addEventListener("click", lock);
  document.querySelector<HTMLButtonElement>("#mobile-lock")!.addEventListener("click", lock);
  document.querySelector<HTMLButtonElement>("#export-button")!.addEventListener("click", () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = element("a");
    link.href = url;
    link.download = `allinone-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function heading(eyebrow: string, title: string, subtitle: string): HTMLElement {
  const wrap = element("div", "page-heading");
  wrap.append(element("span", "eyebrow", eyebrow), element("h1", "", title), element("p", "", subtitle));
  return wrap;
}

function dueLabel(due: string | null): string {
  return due ? due.split("-").reverse().join(".") : "Ohne Termin";
}

function taskList(tasks: Task[], emptyText: string): HTMLElement {
  const list = element("div", "item-list");
  if (!tasks.length) {
    list.append(element("p", "empty", emptyText));
    return list;
  }
  for (const task of tasks) {
    const row = element("div", `task-row ${task.done ? "done" : ""}`);
    const checkbox = element("input") as HTMLInputElement;
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", `Aufgabe ${task.title} abschließen`);
    checkbox.addEventListener("change", () => {
      changeData((data) => { const item = data.tasks.find((entry) => entry.id === task.id); if (item) item.done = checkbox.checked; })
        .catch(() => { checkbox.checked = !checkbox.checked; window.alert("Speichern fehlgeschlagen."); });
    });
    const text = element("div", "task-text");
    text.append(element("strong", "", task.title), element("small", "", `${dueLabel(task.due)} · ${task.priority}`));
    const remove = element("button", "icon-button", "×") as HTMLButtonElement;
    remove.type = "button";
    remove.setAttribute("aria-label", `Aufgabe ${task.title} löschen`);
    remove.addEventListener("click", () => {
      if (window.confirm(`Aufgabe „${task.title}“ löschen?`)) {
        changeData((data) => { data.tasks = data.tasks.filter((entry) => entry.id !== task.id); })
          .catch(() => window.alert("Löschen fehlgeschlagen."));
      }
    });
    row.append(checkbox, text, remove);
    list.append(row);
  }
  return list;
}

function sortedTasks(): Task[] {
  return [...session!.data.tasks].sort((a, b) => Number(a.done) - Number(b.done)
    || (a.due || "9999").localeCompare(b.due || "9999") || b.createdAt.localeCompare(a.createdAt));
}

function renderDashboard(content: HTMLElement): void {
  const data = session!.data;
  const open = data.tasks.filter((task) => !task.done);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  content.append(heading("ÜBERSICHT", "Hallo, schön dass du da bist.", "Ein ruhiger Blick auf alles, was gerade wichtig ist."));
  const stats = element("div", "stats");
  for (const [value, label, symbol] of [
    [String(open.length), "Offene Aufgaben", "✓"],
    [String(open.filter((task) => task.due && task.due <= today).length), "Heute & überfällig", "◷"],
    [String(data.notes.length), "Notizen", "▤"],
    [String(data.passwords.length), "Zugänge", "⌘"],
    [formatEuro(data.accounts.reduce((sum, account) => sum + balance(account, data.transactions), 0)), "Gesamtbestand", "◈"]
  ]) {
    const card = element("div", "stat-card");
    card.append(element("span", "stat-symbol", symbol), element("strong", "", value), element("span", "", label));
    stats.append(card);
  }
  content.append(stats);
  const grid = element("div", "dashboard-grid");
  const tasks = element("section", "panel");
  const taskHeader = element("div", "panel-heading");
  taskHeader.append(element("h2", "", "Als Nächstes"));
  const taskButton = element("button", "text-button", "Alle Aufgaben →");
  taskButton.addEventListener("click", () => { tab = "tasks"; render(); });
  taskHeader.append(taskButton);
  tasks.append(taskHeader, taskList(sortedTasks().filter((task) => !task.done).slice(0, 5), "Noch keine offenen Aufgaben."));
  const notes = element("section", "panel");
  const noteHeader = element("div", "panel-heading");
  noteHeader.append(element("h2", "", "Letzte Notizen"));
  const noteButton = element("button", "text-button", "Alle Notizen →");
  noteButton.addEventListener("click", () => { tab = "notes"; render(); });
  noteHeader.append(noteButton);
  notes.append(noteHeader);
  const recent = [...data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  if (!recent.length) notes.append(element("p", "empty", "Noch keine Notizen. Halte deinen ersten Gedanken fest."));
  for (const note of recent) {
    const item = element("button", "note-preview");
    item.append(element("strong", "", note.title), element("span", "", note.body.slice(0, 100) || "Leere Notiz"));
    item.addEventListener("click", () => { editingNote = note.id; tab = "notes"; render(); });
    notes.append(item);
  }
  grid.append(tasks, notes);
  content.append(grid);
  content.append(element("p", "hint", "Dein Tresor bleibt verschlüsselt. Exportiere regelmäßig eine Sicherung."));
}

function renderTasks(content: HTMLElement): void {
  content.append(heading("DEIN FOKUS", "Aufgaben", "Was ansteht, auf einen Blick. Eins nach dem anderen."));
  const panel = element("section", "panel");
  panel.innerHTML = '<h2>Neue Aufgabe</h2><form id="task-form" class="task-form"><label for="task-title">Titel</label><input id="task-title" type="text" maxlength="160" placeholder="Was möchtest du erledigen?" required /><div class="form-pair"><div><label for="task-due">Fällig am</label><input id="task-due" type="date" /></div><div><label for="task-priority">Priorität</label><select id="task-priority"><option value="mittel">Mittel</option><option value="niedrig">Niedrig</option><option value="hoch">Hoch</option></select></div></div><button class="primary" type="submit">Aufgabe hinzufügen +</button></form>';
  panel.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = panel.querySelector<HTMLInputElement>("#task-title")!.value.trim();
    if (!title) return;
    const due = panel.querySelector<HTMLInputElement>("#task-due")!.value || null;
    const priority = panel.querySelector<HTMLSelectElement>("#task-priority")!.value as Priority;
    try {
      await changeData((data) => data.tasks.push({ id: crypto.randomUUID(), title, due, priority, done: false, createdAt: new Date().toISOString() }));
    } catch { window.alert("Aufgabe konnte nicht gespeichert werden."); }
  });
  content.append(panel);
  const listPanel = element("section", "panel list-panel");
  listPanel.append(element("h2", "", `Deine Aufgaben (${session!.data.tasks.length})`), taskList(sortedTasks(), "Noch keine Aufgaben. Beginne mit einer kleinen Sache."));
  content.append(listPanel);
}

function renderNotes(content: HTMLElement): void {
  content.append(heading("WISSENSBASIS", "Notizen", "Markdown, Verknüpfungen und dein persönliches Wissensnetz."));
  const tools = element("div", "note-tools");
  const search = element("input") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Notizen durchsuchen";
  search.setAttribute("aria-label", "Notizen durchsuchen");
  tools.append(search);
  const exportButton = element("button", "outline-button", "Markdown exportieren");
  exportButton.addEventListener("click", () => {
    const files: Record<string, Uint8Array> = {};
    for (const note of session!.data.notes) {
      const filename = `${note.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}-${note.id.slice(0, 8)}.md`;
      files[filename] = strToU8(note.body);
    }
    const url = URL.createObjectURL(new Blob([zipSync(files) as BlobPart], { type: "application/zip" }));
    const link = element("a");
    link.href = url;
    link.download = "allinone-notizen.zip";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const importLabel = element("label", "outline-button", "Markdown importieren");
  const importInput = element("input") as HTMLInputElement;
  importInput.type = "file";
  importInput.accept = ".md,text/markdown";
  importInput.multiple = true;
  importInput.className = "visually-hidden";
  importLabel.append(importInput);
  importInput.addEventListener("change", async () => {
    const files = [...(importInput.files || [])].filter((file) => file.name.toLowerCase().endsWith(".md"));
    if (!files.length) return;
    try {
      if (files.some((file) => file.size > 1_000_000) || files.reduce((sum, file) => sum + file.size, 0) > 10_000_000) throw new Error("Markdown-Import zu groß.");
      const notes = await Promise.all(files.map(async (file) => ({ id: crypto.randomUUID(),
        title: file.name.replace(/\.md$/i, ""), body: await file.text(), updatedAt: new Date().toISOString() })));
      await changeData((data) => data.notes.push(...notes));
    } catch (error) { window.alert(error instanceof Error ? error.message : "Import fehlgeschlagen."); }
  });
  tools.append(importLabel, exportButton);
  content.append(tools);
  const selected = session!.data.notes.find((note) => note.id === editingNote);
  const editor = element("section", "panel");
  editor.innerHTML = `<h2>${selected ? "Notiz bearbeiten" : "Neue Notiz"}</h2><form id="note-form"><label for="note-title">Titel</label><input id="note-title" type="text" maxlength="160" placeholder="Titel deiner Notiz" required /><label for="note-body">Markdown-Inhalt · [[Notiztitel]] verknüpft Notizen</label><textarea id="note-body" rows="8" maxlength="100000" placeholder="Schreib einfach los ..."></textarea><div class="button-row"><button class="primary" type="submit">${selected ? "Änderungen speichern" : "Notiz speichern"}</button><button id="note-cancel" class="outline-button" type="button">${selected ? "Abbrechen" : "Leeren"}</button></div></form><h3>Vorschau</h3><div id="markdown-preview" class="markdown-preview"></div>`;
  editor.querySelector<HTMLInputElement>("#note-title")!.value = selected?.title || "";
  editor.querySelector<HTMLTextAreaElement>("#note-body")!.value = selected?.body || "";
  const preview = editor.querySelector<HTMLDivElement>("#markdown-preview")!;
  const updatePreview = () => { preview.innerHTML = DOMPurify.sanitize(marked.parse(editor.querySelector<HTMLTextAreaElement>("#note-body")!.value, { async: false }) as string, { FORBID_TAGS: ["img", "iframe"], FORBID_ATTR: ["style"] }); };
  editor.querySelector<HTMLTextAreaElement>("#note-body")!.addEventListener("input", updatePreview);
  updatePreview();
  if (selected) {
    const links = wikiLinks(selected.body);
    const backlinks = session!.data.notes.filter((note) => note.id !== selected.id && wikiLinks(note.body).includes(selected.title));
    const related = element("div", "related-notes");
    related.append(element("strong", "", "Verknüpfungen"));
    for (const title of links) {
      const target = session!.data.notes.find((note) => note.title === title);
      const button = element("button", "text-button", `→ ${title}`);
      button.disabled = !target;
      button.addEventListener("click", () => { editingNote = target!.id; render(); });
      related.append(button);
    }
    for (const note of backlinks) {
      const button = element("button", "text-button", `← ${note.title}`);
      button.addEventListener("click", () => { editingNote = note.id; render(); });
      related.append(button);
    }
    if (!links.length && !backlinks.length) related.append(element("span", "hint", "Noch keine Verknüpfungen."));
    editor.append(related);
  }
  editor.querySelector<HTMLButtonElement>("#note-cancel")!.addEventListener("click", () => { editingNote = null; render(); });
  editor.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = editor.querySelector<HTMLInputElement>("#note-title")!.value.trim();
    const body = editor.querySelector<HTMLTextAreaElement>("#note-body")!.value;
    if (!title) return;
    try {
      await changeData((data) => {
        const note = data.notes.find((entry) => entry.id === editingNote);
        if (note) { note.title = title; note.body = body; note.updatedAt = new Date().toISOString(); }
        else data.notes.push({ id: crypto.randomUUID(), title, body, updatedAt: new Date().toISOString() });
      });
      editingNote = null;
      render();
    } catch { window.alert("Notiz konnte nicht gespeichert werden."); }
  });
  content.append(editor);
  const notes = element("section", "panel list-panel");
  notes.append(element("h2", "", `Alle Notizen (${session!.data.notes.length})`));
  const list = element("div", "notes-grid");
  for (const note of [...session!.data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const card = element("article", "note-card");
    card.append(element("strong", "", note.title), element("p", "", note.body.slice(0, 180) || "Leere Notiz"));
    const actions = element("div", "note-actions");
    const edit = element("button", "text-button", "Bearbeiten");
    edit.addEventListener("click", () => { editingNote = note.id; render(); document.querySelector<HTMLInputElement>("#note-title")?.focus(); });
    const remove = element("button", "text-button danger", "Löschen");
    remove.addEventListener("click", () => {
      if (window.confirm(`Notiz „${note.title}“ löschen?`)) {
        changeData((data) => { data.notes = data.notes.filter((entry: Note) => entry.id !== note.id); })
          .catch(() => window.alert("Löschen fehlgeschlagen."));
      }
    });
    actions.append(edit, remove);
    card.append(actions);
    list.append(card);
  }
  search.addEventListener("input", () => {
    const query = search.value.toLocaleLowerCase();
    list.querySelectorAll<HTMLElement>(".note-card").forEach((card) => { card.hidden = !card.textContent?.toLocaleLowerCase().includes(query); });
  });
  if (!session!.data.notes.length) list.append(element("p", "empty", "Noch keine Notizen vorhanden."));
  notes.append(list);
  content.append(notes);
  if (session!.data.notes.length > 1) content.append(noteGraph(session!.data.notes));
}

function noteGraph(notes: Note[]): HTMLElement {
  const panel = element("section", "panel graph-panel");
  panel.append(element("h2", "", "Wissensnetz"));
  const shown = notes.slice(0, 24);
  const byTitle = new Map(shown.map((note, index) => [note.title, index]));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 700 380");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Verbindungen zwischen Notizen");
  const points = shown.map((_, index) => ({ x: 350 + 245 * Math.cos(index * 2 * Math.PI / shown.length), y: 190 + 135 * Math.sin(index * 2 * Math.PI / shown.length) }));
  shown.forEach((note, source) => {
    for (const targetTitle of wikiLinks(note.body)) {
      const target = byTitle.get(targetTitle);
      if (target === undefined) continue;
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(points[source].x)); line.setAttribute("y1", String(points[source].y));
      line.setAttribute("x2", String(points[target].x)); line.setAttribute("y2", String(points[target].y));
      line.setAttribute("class", "graph-edge");
      svg.append(line);
    }
  });
  shown.forEach((note, index) => {
    const group = document.createElementNS(ns, "g");
    group.setAttribute("class", "graph-node");
    group.setAttribute("transform", `translate(${points[index].x},${points[index].y})`);
    group.setAttribute("tabindex", "0");
    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", "22");
    const title = document.createElementNS(ns, "title"); title.textContent = note.title;
    const label = document.createElementNS(ns, "text"); label.textContent = note.title.slice(0, 15);
    label.setAttribute("y", "40"); label.setAttribute("text-anchor", "middle");
    group.append(title, circle, label);
    group.addEventListener("click", () => { editingNote = note.id; render(); });
    group.addEventListener("keydown", (event) => { if (event.key === "Enter") { editingNote = note.id; render(); } });
    svg.append(group);
  });
  panel.append(svg);
  return panel;
}

function render(): void {
  if (!session) { renderGate(); return; }
  renderShell();
  const content = document.querySelector<HTMLElement>("#content")!;
  if (tab === "dashboard") renderDashboard(content);
  if (tab === "tasks") renderTasks(content);
  if (tab === "notes") renderNotes(content);
  const context: ViewContext = { content, data: session.data, changeData, render, heading, element };
  if (tab === "passwords") renderPasswords(context);
  if (tab === "finances") renderFinances(context);
  if (tab === "servers" || tab === "sync") {
    const connected: ConnectContext = {
      ...context,
      envelope: session.envelope,
      replaceVault: async (envelope, passphrase) => {
        const { data, key } = await unlockVault(envelope, passphrase);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
        session = { data, key, envelope };
        render();
      },
      navigate: (next) => { tab = next; render(); }
    };
    if (tab === "sync") renderSync(connected);
    else renderServers(connected);
  }
}

render();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}

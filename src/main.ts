import "./style.css";
import {
  DEFAULT_PREFERENCES, createVault, encryptVault, parseEnvelope, unlockVault,
  type Note, type Priority, type Task, type VaultData, type VaultEnvelope
} from "./vault";
import { balance, formatEuro, sumCents } from "./domain";
import { wikiLinks } from "./domain";
import { openFinanceEntry, openPassword, renderFinances, renderPasswords, type ViewContext } from "./features";
import { clearServerBaseline, getSyncStatus, pollServerSync, renderServers, renderSync, scheduleServerSync, type ConnectContext } from "./connect";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { strToU8, zipSync } from "fflate";
import { gateLockArtwork, revealWorkspace } from "./unlock-animation";
import { renderAdvancedTasks } from "./tasks";
import { appendNoteExtras, rememberNote } from "./note-extras";
import { renderFinanceExtras } from "./finance-extras";
import { backupError, saveBackup } from "./backups";
import { completeTask, downloadFile } from "./productivity";
import { addGlobalSearch, dashboardTools, renderSettings, checkReminders, captureSharedLink } from "./workspace-extras";
import { renderAI } from "./ai";
import { assertVaultEpoch, invalidateVault, vaultEpoch, vaultSignal } from "./lifecycle";
import { STORAGE_KEY, assertStoredVault, withVaultLock } from "./storage";
import { captureDrafts, restoreDrafts, hasDrafts, clearDrafts, currentSubmission, clearFormDraft } from "./drafts";
import { openTask, resetTaskEditor } from "./tasks";
import { resetPasswordEditor } from "./features";


const app = document.querySelector<HTMLDivElement>("#app")!;
type Tab = "dashboard" | "tasks" | "notes" | "passwords" | "finances" | "servers" | "sync" | "settings" | "ai";

let viewController = new AbortController();
let session: { data: VaultData; key: CryptoKey; envelope: VaultEnvelope } | null = null;
let tab: Tab = "dashboard";
let editingNote: string | null = null;
let lastActivity = Date.now();
let changeQueue = Promise.resolve();
let pendingChanges = 0;

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    const search = document.querySelector<HTMLInputElement>('.global-search input');
    if (search) { event.preventDefault(); search.focus(); }
  }
});


for (const eventName of ["pointerdown", "keydown"]) {
  window.addEventListener(eventName, () => { lastActivity = Date.now(); }, { passive: true });
}
window.setInterval(() => {
  if (session && Date.now() - lastActivity > (session.data.preferences || DEFAULT_PREFERENCES).lockMinutes * 60 * 1000) {
    lockVault();
  }
}, 30_000);

function lockVault(): void {
  invalidateVault();
  session = null;
  editingNote = null;
  resetTaskEditor(); resetPasswordEditor(); clearDrafts();
  tab = "dashboard";
  render();
}
function pollNow(): void {
  const active = session;
  if (!active || pendingChanges || hasDrafts()) return;
  void pollServerSync(active.envelope, active.key, async (envelope, data) => {
    return withVaultLock(async () => {
      if (session !== active || pendingChanges || hasDrafts()) return false;
      const raw = JSON.stringify(active.envelope);
      assertStoredVault(raw);
      await saveBackup(raw);
      if (session !== active || pendingChanges || hasDrafts()) return false;
      assertStoredVault(raw);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
      void saveBackup(JSON.stringify(envelope)).catch(() => undefined);
      session = { ...active, data, envelope }; render(); return true;
    });
  });
}

window.setInterval(pollNow, 30_000);
window.addEventListener("focus", pollNow);
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY && (!session || event.newValue !== JSON.stringify(session.envelope))) {
    lockVault();
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

async function changeData(update: (data: VaultData) => void, expectedEpoch = vaultEpoch()): Promise<void> {
  const form = currentSubmission();
  if (form) { form.inert = true; form.setAttribute("aria-busy", "true"); }
  pendingChanges++;
  const pending = changeQueue.then(() => withVaultLock(async () => {
    assertVaultEpoch(expectedEpoch);
    const active = session;
    if (!active) throw new Error("Tresor ist gesperrt. Bitte erneut entsperren.");
    const raw = JSON.stringify(active.envelope);
    assertStoredVault(raw);
    const next = structuredClone(active.data); update(next);
    const envelope = await encryptVault(next, active.key, active.envelope.kdf.salt);
    await saveBackup(raw).catch(() => undefined);
    assertVaultEpoch(expectedEpoch); assertStoredVault(raw);
    if (session !== active) throw new Error("Der Tresor wurde zwischenzeitlich geändert. Bitte erneut versuchen.");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    void saveBackup(JSON.stringify(envelope)).catch(() => undefined);
    session = { ...active, data: next, envelope };
    clearFormDraft(form); render(); scheduleServerSync();
  }));
  changeQueue = pending.catch(() => undefined);
  try { await pending; } finally { pendingChanges--; if (form) { form.inert = false; form.removeAttribute("aria-busy"); } }
}

function renderGate(): void {
  const hasVault = localStorage.getItem(STORAGE_KEY) !== null;
  let gateBusy = false;
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
          <div class="card-icon gate-lock" aria-hidden="true">${gateLockArtwork}</div>
          <h2>${hasVault ? "Willkommen zurück" : "Deinen Raum einrichten"}</h2>
          <p>${hasVault ? "Entsperre deinen lokalen Tresor." : "Erstelle eine Passphrase mit mindestens 14 Zeichen. Sie kann nicht wiederhergestellt werden."}</p>
          <form id="vault-form">
            <label for="passphrase">Passphrase</label>
            <input id="passphrase" type="password" autocomplete="${hasVault ? "current-password" : "new-password"}" minlength="${hasVault ? 1 : 14}" required />
            ${hasVault ? "" : '<label for="confirm">Passphrase wiederholen</label><input id="confirm" type="password" autocomplete="new-password" minlength="14" required />'}
            <button class="primary full" type="submit">${hasVault ? "Tresor entsperren" : "Tresor erstellen"}<span aria-hidden="true">→</span></button>
          </form>
          <div id="message" class="message" role="status" aria-live="polite"></div>
${hasVault ? '<button id="locked-backup" class="outline-button full" type="button">Verschlüsselten Tresor sichern</button>' : ""}
          <div class="gate-divider">oder</div>
          <label class="import-label" for="import-file">Verschlüsselte Sicherung importieren</label>
          <input id="import-file" class="visually-hidden" type="file" accept="application/json,.json" />
          <p class="tiny">Ohne deine Passphrase ist eine Sicherung nicht lesbar. Exportiere regelmäßig eine Kopie.</p>
        </section>
      </div>
    </main>`;

  if (!window.isSecureContext || !crypto.subtle || !navigator.locks) {
    announce("Für den verschlüsselten Tresor sind HTTPS (oder localhost) und ein aktueller Browser erforderlich.", true);
    document.querySelector<HTMLButtonElement>("#vault-form button")!.disabled = true;
  }
  document.querySelector("#locked-backup")?.addEventListener("click", () => { const raw = localStorage.getItem(STORAGE_KEY); if (raw) downloadFile(`allinone-sicherung-${new Date().toISOString().slice(0, 10)}.json`, raw); });

  document.querySelector<HTMLFormElement>("#vault-form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (gateBusy) return;
    const passphrase = document.querySelector<HTMLInputElement>("#passphrase")!.value;
    const expectedEpoch = vaultEpoch();
    const expectedRaw = localStorage.getItem(STORAGE_KEY);
    const button = document.querySelector<HTMLButtonElement>("#vault-form button")!;
    const form = document.querySelector<HTMLFormElement>("#vault-form")!;
    const originalLabel = button.innerHTML;
    gateBusy = true;
    button.disabled = true;
    button.classList.add("is-opening");
    button.textContent = hasVault ? "Wird entsperrt …" : "Wird eingerichtet …";
    form.setAttribute("aria-busy", "true");
    announce("");
    try {
      if ((expectedRaw !== null) !== hasVault) throw new Error("Tresor geändert. Bitte die Seite neu laden.");
      if (hasVault) {
        const envelope = storedEnvelope()!;
        const { data, key } = await unlockVault(envelope, passphrase);
        await withVaultLock(() => { assertVaultEpoch(expectedEpoch); assertStoredVault(expectedRaw); session = { data, key, envelope }; });
      } else {
        if (passphrase !== document.querySelector<HTMLInputElement>("#confirm")!.value) {
          throw new Error("Die Passphrasen stimmen nicht überein.");
        }
        const created = await createVault(passphrase);
        await withVaultLock(() => { assertVaultEpoch(expectedEpoch); assertStoredVault(expectedRaw); localStorage.setItem(STORAGE_KEY, JSON.stringify(created.envelope)); clearServerBaseline(); session = created; });
      }
      lastActivity = Date.now();
      void saveBackup(JSON.stringify(session!.envelope)).catch(() => undefined);
      await revealWorkspace(app, render);
      pollNow();
    } catch (error) {
      announce(error instanceof Error ? error.message : "Tresor konnte nicht geöffnet werden.", true);
      button.disabled = false;
      button.classList.remove("is-opening");
      button.innerHTML = originalLabel;
    } finally {
      gateBusy = false;
      form.removeAttribute("aria-busy");
    }
  });

  document.querySelector<HTMLInputElement>("#import-file")!.addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || gateBusy) return;
    gateBusy = true;
    const expectedEpoch = vaultEpoch();
    const expectedRaw = localStorage.getItem(STORAGE_KEY);
    try {
      if (file.size > 10_000_000) throw new Error("Sicherung ist zu groß (maximal 10 MB).");
      const passphrase = document.querySelector<HTMLInputElement>("#passphrase")!.value;
      if (!passphrase) throw new Error("Gib zuerst die Passphrase der Sicherung ein.");
      const envelope = parseEnvelope(await file.text());
      const { data, key } = await unlockVault(envelope, passphrase);
      if (hasVault && !window.confirm("Den bestehenden lokalen Tresor durch diese Sicherung ersetzen?")) return;
      await withVaultLock(async () => {
        assertVaultEpoch(expectedEpoch); assertStoredVault(expectedRaw);
        if (expectedRaw) await saveBackup(expectedRaw);
        assertVaultEpoch(expectedEpoch); assertStoredVault(expectedRaw);
        invalidateVault(); clearDrafts(); resetTaskEditor(); resetPasswordEditor(); editingNote = null;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
        clearServerBaseline(); session = { data, key, envelope };
      });
      void saveBackup(JSON.stringify(envelope)).catch(() => undefined);
      lastActivity = Date.now();
      await revealWorkspace(app, render);
    } catch (error) {
      announce(error instanceof Error ? error.message : "Import fehlgeschlagen.", true);
    } finally {
      gateBusy = false;
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
          <button data-tab="finances"><span>◈</span> Finanzen</button><button data-tab="ai"><span>✧</span> KI-Assistent</button><button data-tab="settings"><span>⚙</span> Einstellungen</button>
        </nav>
        <div class="nav-label later">VERBINDEN</div>
        <nav aria-label="Verbindungen"><button data-tab="sync"><span>↗</span> Synchronisation</button><button data-tab="servers"><span>▣</span> VPS</button></nav>
        <div class="sidebar-bottom"><div class="local-badge"><span class="status-dot"></span> Lokal & verschlüsselt</div><small id="backup-status"></small><button id="lock-button" class="text-button">⇥ Tresor sperren</button></div>
      </aside>
      <div class="main-column">
        <header class="topbar"><span id="sync-status" class="sync-status" role="status"></span><div><button id="mobile-lock" class="outline-button">Sperren</button> <button id="export-button" class="outline-button">↓ Sicherung exportieren</button></div></header>
        <div id="reminder-banner" class="reminder-banner" role="status"></div><main id="content" class="content"></main>
      </div>
    </div>`;
  document.querySelector("#sync-status")!.textContent = getSyncStatus();
  document.querySelector("#backup-status")!.textContent = backupError;
  addGlobalSearch(document.querySelector<HTMLElement>(".topbar")!, session!.data, (kind, id) => {
    if (kind === "passwords") openPassword(id);
    if (kind === "tasks") openTask(id);
    if (kind === "finances") openFinanceEntry(id);
    tab = kind as Tab; editingNote = kind === "notes" ? id : null; render();
    [...app.querySelectorAll<HTMLElement>("[data-entry-id]")].find((e) => e.dataset.entryId === id)?.scrollIntoView({ block: "center" });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
    button.addEventListener("click", () => { tab = button.dataset.tab as Tab; editingNote = null; render(); });
  });
  const lock = lockVault;
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
      const done = checkbox.checked;
      changeData((data) => { completeTask(data, task.id, done); })
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
    [formatEuro(sumCents(data.accounts.map((account) => balance(account, data.transactions)))), "Gesamtbestand", "◈"]
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
    for (const [index, note] of session!.data.notes.entries()) {
      const filename = `${index + 1}-${note.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "Notiz"}.md`;
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
    const expectedEpoch = vaultEpoch();
    const files = [...(importInput.files || [])].filter((file) => file.name.toLowerCase().endsWith(".md"));
    if (!files.length) return;
    try {
      if (files.some((file) => file.size > 1_000_000) || files.reduce((sum, file) => sum + file.size, 0) > 10_000_000) throw new Error("Markdown-Import zu groß.");
      const notes = await Promise.all(files.map(async (file) => ({ id: crypto.randomUUID(),
        title: file.name.replace(/\.md$/i, ""), body: await file.text(), updatedAt: new Date().toISOString() })));
      await changeData((data) => data.notes.push(...notes), expectedEpoch);
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
  editor.querySelector<HTMLButtonElement>("#note-cancel")!.addEventListener("click", () => { clearFormDraft(editor.querySelector<HTMLFormElement>("form")!); editingNote = null; render(); });
  editor.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = editor.querySelector<HTMLInputElement>("#note-title")!.value.trim();
    const body = editor.querySelector<HTMLTextAreaElement>("#note-body")!.value;
    const noteId = selected?.id;
    const folder = editor.querySelector<HTMLInputElement>("#note-folder")!.value.trim();
    const tags = [...new Set(editor.querySelector<HTMLInputElement>("#note-tags")!.value.split(",").map((t) => t.trim()).filter(Boolean))];
    if (!title) return;
    try {
      await changeData((data) => {
        const note = data.notes.find((entry) => entry.id === noteId);
        if (note) { if (note.title !== title || note.body !== body) rememberNote(note); Object.assign(note, { title, body, folder, tags, updatedAt: new Date().toISOString() }); }
        else data.notes.push({ id: crypto.randomUUID(), title, body, folder, tags, updatedAt: new Date().toISOString() });
      });
      if (editingNote === noteId) editingNote = null;
      render();
    } catch { window.alert("Notiz konnte nicht gespeichert werden."); }
  });
  editor.querySelector<HTMLFormElement>("form")!.dataset.draftKey = selected?.id || "new";
  const noteEpoch = vaultEpoch();
  appendNoteExtras(editor, selected, (update) => changeData(update, noteEpoch));
  content.append(editor);
  const notes = element("section", "panel list-panel");
  notes.append(element("h2", "", `Alle Notizen (${session!.data.notes.length})`));
  const list = element("div", "notes-grid");
  for (const note of [...session!.data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) {
    const card = element("article", "note-card");
    card.append(element("strong", "", note.title), element("small", "tag-list", [note.folder, ...(note.tags || []).map((t) => `#${t}`)].filter(Boolean).join(" · ")), element("p", "", note.body.slice(0, 180) || "Leere Notiz"));
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
  const folderFilter = element("select"); folderFilter.setAttribute("aria-label", "Notizordner"); folderFilter.add(new Option("Alle Ordner", ""));
  [...new Set(session!.data.notes.map((n) => n.folder || "").filter(Boolean))].sort().forEach((f) => folderFilter.add(new Option(f, f)));
  tools.prepend(folderFilter);
  const filterNotes = () => {
    const query = search.value.toLocaleLowerCase();
    list.querySelectorAll<HTMLElement>(".note-card").forEach((card, index) => { const note = [...session!.data.notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[index]; card.hidden = !`${note.title} ${note.body} ${note.folder || ""} ${(note.tags || []).join(" ")}`.toLocaleLowerCase().includes(query) || Boolean(folderFilter.value && note.folder !== folderFilter.value); });
  };
  search.addEventListener("input", filterNotes); folderFilter.addEventListener("change", filterNotes);
  if (!session!.data.notes.length) list.append(element("p", "empty", "Noch keine Notizen vorhanden."));
  notes.append(list);
  content.append(notes);
  if (session!.data.notes.length > 1) content.append(noteGraph(session!.data.notes));
}

function noteGraph(notes: Note[]): HTMLElement {
  const panel = element("section", "panel graph-panel");
  panel.append(element("h2", "", "Wissensnetz"));
  const shown = notes.slice(0, 24);
  const byTitle = new Map<string, number>();
  shown.forEach((note, index) => { if (!byTitle.has(note.title)) byTitle.set(note.title, index); });
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
  viewController.abort(); viewController = new AbortController();
  const drafts = session ? captureDrafts(app) : [];
  if (!session) { renderGate(); return; }
  const action = new URLSearchParams(location.search).get("action");
  if (action && ["task", "note"].includes(action)) { tab = action === "task" ? "tasks" : "notes"; history.replaceState(null, "", location.pathname); }
  renderShell();
  const content = document.querySelector<HTMLElement>("#content")!;
  if (tab === "dashboard") renderDashboard(content);

  if (tab === "notes") renderNotes(content);
  const active = session;
  const expectedEpoch = vaultEpoch();
  const context: ViewContext = { content, data: active.data,
    changeData: (update) => content.isConnected ? changeData(update, expectedEpoch) : Promise.reject(new Error("Diese Ansicht ist nicht mehr aktiv. Bitte erneut versuchen.")),
    render: () => { assertVaultEpoch(expectedEpoch); render(); },
    isActive: () => vaultEpoch() === expectedEpoch && Boolean(session) && content.isConnected, signal: AbortSignal.any([vaultSignal(), viewController.signal]), heading, element };
  if (tab === "dashboard") dashboardTools(context, (next) => { tab = next as Tab; render(); });
  if (tab === "tasks") renderAdvancedTasks(context);
  if (tab === "passwords") renderPasswords(context);
  if (tab === "finances") { renderFinances(context); renderFinanceExtras(context); }
  if (tab === "ai") renderAI(context);
  if (tab === "servers" || tab === "sync" || tab === "settings") {
    const connected: ConnectContext = {
      ...context,
      envelope: session.envelope,
      replaceVault: async (envelope, passphrase) => {
        assertVaultEpoch(expectedEpoch);
        const previous = JSON.stringify(active.envelope);
        const { data, key } = await unlockVault(envelope, passphrase);
        await withVaultLock(async () => {
          assertVaultEpoch(expectedEpoch); assertStoredVault(previous);
          if (session !== active || pendingChanges) throw new Error("Lokale Daten geändert. Bitte erneut laden.");
          await saveBackup(previous);
          assertVaultEpoch(expectedEpoch); assertStoredVault(previous);
          if (session !== active || pendingChanges) throw new Error("Lokale Daten geändert. Bitte erneut laden.");
          invalidateVault(); clearDrafts(); resetTaskEditor(); resetPasswordEditor(); editingNote = null;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope)); clearServerBaseline();
          session = { data, key, envelope }; lastActivity = Date.now();
        });
        void saveBackup(JSON.stringify(envelope)).catch(() => undefined); render();
      },
      navigate: (next) => { tab = next; render(); }
    };
    if (tab === "settings") renderSettings(connected);
    else if (tab === "sync") renderSync(connected);
    else renderServers(connected);
  }
  content.querySelectorAll<HTMLFormElement>("form").forEach((form, index) => { if (!form.id) form.id = `workspace-form-${tab}-${index}`; });
  restoreDrafts(app, drafts);
  checkReminders(context);
  captureSharedLink(context);
}

window.setInterval(() => { const badge = document.querySelector("#sync-status"); if (badge) badge.textContent = getSyncStatus(); const backup = document.querySelector("#backup-status"); if (backup) backup.textContent = backupError; }, 3000);
window.setInterval(() => { if (session) checkReminders({ data: session.data } as ViewContext); }, 15_000);
try { render(); }
catch {
  app.replaceChildren(element("main", "gate", "Der Browser-Speicher ist nicht verfügbar. Erlaube Website-Speicher für AllINONE und lade die Seite neu. Vorhandene Browserdaten bitte nicht löschen."));
}
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => undefined));
}

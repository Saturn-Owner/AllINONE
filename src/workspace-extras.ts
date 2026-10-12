import type { ViewContext } from "./features";
import { DEFAULT_PREFERENCES, parseEnvelope, type VaultEnvelope } from "./vault";
import { backupError, listBackups, saveBackup } from "./backups";
import { downloadFile, globalSearch, localDate } from "./productivity";
import { nextRecurringDate, formatEuro } from "./domain";
export interface WorkspaceContext extends ViewContext { envelope: VaultEnvelope; replaceVault: (envelope: VaultEnvelope, passphrase: string) => Promise<void> }
const widgetNames: Record<string, string> = { tasks: "Aufgaben", notes: "Notizen", payments: "Nächste Zahlungen" };
export function dashboardTools(ctx: ViewContext, navigate: (tab: string) => void): void {
  const { content, data, element: el } = ctx;
  const panel = el("section", "panel quick-capture"); panel.innerHTML = '<h2>Schnelleingabe</h2><form id="quick-form" class="button-row wrap"><select id="quick-kind" aria-label="Art der Schnelleingabe"><option value="tasks">Aufgabe</option><option value="notes">Notiz</option></select><input id="quick-text" aria-label="Schnelleingabe" maxlength="1000" placeholder="Ein Gedanke oder eine Aufgabe …" required /><button class="primary">Speichern</button></form>';
  panel.querySelector("form")!.addEventListener("submit", async (e) => { e.preventDefault(); const text = panel.querySelector<HTMLInputElement>("#quick-text")!.value.trim(); const kind = panel.querySelector<HTMLSelectElement>("#quick-kind")!.value; if (!text) return;
    try { await ctx.changeData((d) => { if (kind === "tasks") d.tasks.push({ id: crypto.randomUUID(), title: text.slice(0, 160), done: false, priority: "mittel", due: null, createdAt: new Date().toISOString() }); else d.notes.push({ id: crypto.randomUUID(), title: text.slice(0, 160), body: text, updatedAt: new Date().toISOString() }); }); } catch { window.alert("Speichern fehlgeschlagen."); }
  }); content.querySelector(".page-heading")?.after(panel);
  const grid = content.querySelector<HTMLElement>(".dashboard-grid")!;
  const tasks = grid.children[0]; const notes = grid.children[1];
  const payments = el("section", "panel"); payments.append(el("h2", "", "Nächste Zahlungen"));
  const upcoming = data.recurring.filter((r) => r.active).sort((a, b) => nextRecurringDate(a).localeCompare(nextRecurringDate(b))).slice(0, 5);
  upcoming.forEach((r) => payments.append(el("p", "", `${nextRecurringDate(r)} · ${r.payee} · ${formatEuro(r.amountCents)}${r.subscription && r.cancelBy ? ` · Kündigung: ${r.cancelBy}` : ""}`)));
  if (!upcoming.length) payments.append(el("p", "empty", "Keine Zahlungen vorgemerkt."));
  const map: Record<string, Element> = { tasks, notes, payments };
  grid.replaceChildren(); (data.preferences || DEFAULT_PREFERENCES).widgets.forEach((id) => grid.append(map[id]));
  const customize = el("button", "text-button", "Dashboard anpassen"); customize.onclick = () => navigate("settings"); content.append(customize);
}
export function addGlobalSearch(container: HTMLElement, data: ViewContext["data"], navigate: (kind: string, id: string) => void): void {
  const wrap = document.createElement("div"); wrap.className = "global-search";
  const input = document.createElement("input"); input.type = "search"; input.placeholder = "Alles durchsuchen …"; input.setAttribute("aria-label", "Globale Suche");
  const results = document.createElement("div"); results.className = "search-results"; results.hidden = true;
  const names: Record<string, string> = { tasks: "Aufgabe", notes: "Notiz", passwords: "Zugang", finances: "Finanzen" };
  input.oninput = () => { results.replaceChildren(); results.hidden = !input.value.trim(); const matches = globalSearch(data, input.value); if (!matches.length && input.value.trim()) results.textContent = "Keine Treffer.";
    matches.forEach((r) => { const button = document.createElement("button"); button.className = "search-result"; const title = document.createElement("strong"); title.textContent = `${names[r.kind]} · ${r.title}`; const detail = document.createElement("small"); detail.textContent = r.detail.slice(0, 100); button.append(title, detail); button.onclick = () => navigate(r.kind, r.id); results.append(button); }); };
  input.onkeydown = (e) => { if (e.key === "Escape") { input.value = ""; results.hidden = true; } };
  wrap.append(input, results); container.prepend(wrap);
}
export function renderSettings(ctx: WorkspaceContext): void {
  const { content, data, element: el } = ctx; const prefs = structuredClone(data.preferences || DEFAULT_PREFERENCES);
  content.append(ctx.heading("DEIN WORKSPACE", "Einstellungen & Sicherungen", "Dein Dashboard, deine Sperre und verschlüsselte Wiederherstellungspunkte."));
  const panel = el("section", "panel"); panel.append(el("h2", "", "Dashboard anpassen"));
  const ordered = [...prefs.widgets, ...Object.keys(widgetNames).filter((id) => !prefs.widgets.includes(id))];
  ordered.forEach((id) => {
    const row = el("div", "finance-row"); const label = el("label", "subtask"); const check = el("input"); check.type = "checkbox"; check.checked = prefs.widgets.includes(id);
    check.onchange = () => { const enabled = check.checked; void ctx.changeData((d) => { d.preferences ||= structuredClone(DEFAULT_PREFERENCES); if (enabled && !d.preferences.widgets.includes(id)) d.preferences.widgets.push(id); else if (!enabled) d.preferences.widgets = d.preferences.widgets.filter((w) => w !== id); }).catch(() => window.alert("Speichern fehlgeschlagen.")); }; label.append(check, document.createTextNode(widgetNames[id])); row.append(label);
    for (const [offset, text] of [[-1, "↑"], [1, "↓"]] as const) { const b = el("button", "outline-button", text); b.setAttribute("aria-label", `${widgetNames[id]} ${offset < 0 ? "nach oben" : "nach unten"}`); const index = prefs.widgets.indexOf(id); b.disabled = index < 0 || index + offset < 0 || index + offset >= prefs.widgets.length; b.onclick = () => void ctx.changeData((d) => { d.preferences ||= structuredClone(DEFAULT_PREFERENCES); const widgets = d.preferences.widgets; const current = widgets.indexOf(id); if (current >= 0 && current + offset >= 0 && current + offset < widgets.length) [widgets[current], widgets[current + offset]] = [widgets[current + offset], widgets[current]]; }).catch(() => window.alert("Speichern fehlgeschlagen.")); row.append(b); } panel.append(row);
  }); content.append(panel);
  const security = el("section", "panel"); security.innerHTML = '<h2>Sperre & Erinnerungen</h2><form id="settings-form"><label for="lock-minutes">Automatisch sperren nach Minuten ohne Eingabe</label><input id="lock-minutes" type="number" min="1" max="120" required /><button class="primary form-submit">Sperrzeit speichern</button></form>';
  security.querySelector<HTMLInputElement>("#lock-minutes")!.value = String(prefs.lockMinutes);
  security.querySelector("form")!.onsubmit = async (e) => { e.preventDefault(); const minutes = Number(security.querySelector<HTMLInputElement>("#lock-minutes")!.value); try { await ctx.changeData((d) => { d.preferences ||= structuredClone(DEFAULT_PREFERENCES); d.preferences.lockMinutes = minutes; }); } catch { window.alert("Sperrzeit konnte nicht gespeichert werden."); } };
  const notify = el("button", "outline-button", prefs.notifications ? "Mitteilungen deaktivieren" : "Browser-Mitteilungen aktivieren");
  notify.onclick = async () => { try { if (!prefs.notifications && (!("Notification" in window) || await Notification.requestPermission() !== "granted")) throw new Error("Dieser Browser hat Mitteilungen nicht freigegeben."); await ctx.changeData((d) => { d.preferences ||= structuredClone(DEFAULT_PREFERENCES); d.preferences.notifications = !prefs.notifications; }); } catch (e) { window.alert(e instanceof Error ? e.message : "Mitteilungen nicht verfügbar."); } };
  security.append(notify, el("p", "hint", "Erinnerungen funktionieren, solange die App geöffnet und der Tresor entsperrt ist. Bei geschlossener App unterstützt der Kalenderexport Erinnerungen über deine Kalender-App.")); content.append(security);
  const extension = el("section", "panel"); extension.append(el("h2", "", "Autofill im Browser"), el("p", "", "Lade die Erweiterung für Chrome, Chromium oder Edge herunter, entpacke sie und lade den Ordner unter Erweiterungen → Entwicklermodus → Entpackte Erweiterung laden. Importiere dort eine aktuelle verschlüsselte Sicherung. Entsperrt wird nur für die Dauer des geöffneten Erweiterungsfensters; ausgefüllt wird nach deinem Klick ausschließlich auf der exakt passenden HTTPS-Website."));
  const link = el("a", "outline-button", "Browser-Erweiterung herunterladen"); link.href = "/allinone-extension.zip"; link.download = "allinone-extension.zip"; extension.append(link); content.append(extension);
  const backups = el("section", "panel"); backups.append(el("h2", "", "Automatische verschlüsselte Sicherungen"), el("p", "hint", "Die letzten 20 unterschiedlichen Stände dieses Tresors bleiben in diesem Browser gespeichert. Sie sind mit deiner Tresor-Passphrase verschlüsselt. Browserdaten zu löschen entfernt auch diese Sicherungen: Exportiere zusätzlich eine Kopie außerhalb des Geräts."));
  const feedback = el("p", "message", backupError); const list = el("div");
  const scopeLabel = el("label", "subtask"); const allVaults = el("input"); allVaults.type = "checkbox"; allVaults.onchange = () => void populate(); scopeLabel.append(allVaults, document.createTextNode("Auch Sicherungen früherer / anderer Tresore anzeigen")); backups.append(scopeLabel);
  const manual = el("button", "outline-button", "Jetzt Sicherungsstand anlegen"); manual.onclick = async () => { try { await saveBackup(JSON.stringify(ctx.envelope)); await populate(); feedback.textContent = "Aktueller Stand gesichert."; } catch { feedback.textContent = "Sicherung fehlgeschlagen. Speicher oder Browserberechtigungen prüfen."; } }; backups.append(manual);
  const label = el("label", "", "Passphrase zum Wiederherstellen"); label.htmlFor = "backup-passphrase";
  const password = el("input"); password.id = "backup-passphrase"; password.type = "password"; password.autocomplete = "off"; backups.append(label, password, list, feedback); content.append(backups);
  async function populate(): Promise<void> {
    try { const snapshots = await listBackups(allVaults.checked ? undefined : ctx.envelope.kdf.salt); if (!backups.isConnected) return; list.replaceChildren();
      if (!snapshots.length) list.append(el("p", "empty", "Noch keine Sicherungsstände."));
      for (const backup of snapshots) {
        const row = el("div", "finance-row"); row.append(el("span", "", `${new Date(backup.createdAt).toLocaleString("de-DE")}${backup.salt === ctx.envelope.kdf.salt ? "" : " · anderer oder beschädigter Tresor"}`));
        const exportButton = el("button", "outline-button", "Sicherung herunterladen"); exportButton.onclick = () => downloadFile(`allinone-${backup.createdAt.replaceAll(":", "-")}.json`, backup.raw);
        const restore = el("button", "outline-button", "Sicherungsstand wiederherstellen"); restore.onclick = async () => { try { if (!password.value) throw new Error("Gib die Passphrase dieses Tresors ein."); if (!window.confirm("Diesen Stand wiederherstellen? Der aktuelle Stand wird vorher verschlüsselt gesichert.")) return; await ctx.replaceVault(parseEnvelope(backup.raw), password.value); } catch (e) { feedback.textContent = e instanceof Error ? e.message : "Wiederherstellen fehlgeschlagen."; } }; row.append(exportButton, restore); list.append(row);
      }
    } catch { feedback.textContent = "Sicherungsarchiv nicht verfügbar. Bitte eine Datei exportieren."; }
  } void populate();
}
const reminded = new Set<string>();
const dismissed = new Set<string>();
export function checkReminders(ctx: ViewContext): void {
  const host = document.querySelector("#reminder-banner"); host?.replaceChildren();
  const show = (id: string, text: string) => {
    if (!host || dismissed.has(id)) return;
    const row = document.createElement("div"); row.className = "reminder-row";
    const p = document.createElement("p"); p.textContent = text;
    const close = document.createElement("button"); close.className = "text-button"; close.textContent = "Schließen"; close.setAttribute("aria-label", `${text} schließen`);
    close.onclick = () => { dismissed.add(id); row.remove(); }; row.append(p, close); host.append(row);
  };
  const notify = (title: string, body: string, tag: string) => {
    if (!ctx.data.preferences?.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
    if (navigator.serviceWorker?.controller) void navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, tag })).catch(() => undefined);
    else try { new Notification(title, { body, tag }); } catch { /* unsupported notification constructor */ }
  };
  for (const task of ctx.data.tasks.filter((t) => !t.done && t.reminderAt && new Date(t.reminderAt).getTime() <= Date.now())) {
    const id = `${task.id}:${task.reminderAt}`; show(id, `Erinnerung: ${task.title}`);
    if (!reminded.has(id)) { reminded.add(id); notify("AllINONE · Aufgabe", task.title, id); }
  }
  for (const payment of ctx.data.recurring.filter((p) => p.subscription && p.active && p.cancelBy && p.cancelBy <= localDate())) {
    const id = `subscription:${payment.id}:${payment.cancelBy}`; show(id, `Kündigungsfrist erreicht: ${payment.payee} (${payment.cancelBy})`);
    if (!reminded.has(id)) { reminded.add(id); notify("AllINONE · Kündigungsfrist", payment.payee, id); }
  }
}
export function captureSharedLink(ctx: ViewContext): void {
  const params = new URLSearchParams(location.search); if (!params.has("share")) return;
  const title = (params.get("title") || params.get("text") || "Geteilter Link").slice(0, 160);
  const body = [params.get("text"), params.get("url")].filter(Boolean).join("\n\n").slice(0, 100000);
  const banner = ctx.element("section", "panel"); banner.append(ctx.element("h2", "", "Geteilten Inhalt speichern"), ctx.element("p", "", title), ctx.element("p", "", body));
  const save = ctx.element("button", "primary", "Als Notiz speichern"); save.onclick = async () => { save.disabled = true; try { await ctx.changeData((d) => d.notes.push({ id: crypto.randomUUID(), title, body, updatedAt: new Date().toISOString() })); history.replaceState(null, "", location.pathname); ctx.render(); } catch { save.disabled = false; window.alert("Speichern fehlgeschlagen."); } };
  const cancel = ctx.element("button", "outline-button", "Verwerfen"); cancel.onclick = () => { history.replaceState(null, "", location.pathname); ctx.render(); }; banner.append(save, cancel); ctx.content.prepend(banner);
}

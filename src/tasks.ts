import type { ViewContext } from "./features";
import type { Task, Priority } from "./vault";
import { completeTask, downloadFile, localDate, tasksCalendar } from "./productivity";
let view = "liste";
let editing: string | null = null;
let calendarMonth = localDate().slice(0, 7);
export function renderAdvancedTasks(ctx: ViewContext): void {
  const { content, data, element: el } = ctx;
  content.append(ctx.heading("DEIN FOKUS", "Aufgaben", "Unteraufgaben, Wiederholungen, Erinnerungen und dein Kalender."));
  const panel = el("section", "panel");
  const selected = data.tasks.find((t) => t.id === editing);
  panel.innerHTML = `<h2>${selected ? "Aufgabe bearbeiten" : "Neue Aufgabe"}</h2><form id="task-form" class="task-form"><label for="task-title">Titel</label><input id="task-title" maxlength="160" required /><div class="form-pair"><div><label for="task-due">Fällig am</label><input id="task-due" type="date" /></div><div><label for="task-priority">Priorität</label><select id="task-priority"><option value="mittel">Mittel</option><option value="niedrig">Niedrig</option><option value="hoch">Hoch</option></select></div></div><div class="form-pair"><div><label for="task-repeat">Wiederholung</label><select id="task-repeat"><option value="keine">Keine</option><option value="täglich">Täglich</option><option value="wöchentlich">Wöchentlich</option><option value="monatlich">Monatlich</option></select></div><div><label for="task-reminder">Erinnerung</label><input id="task-reminder" type="datetime-local" /></div></div><label for="task-subtasks">Unteraufgaben · eine pro Zeile</label><textarea id="task-subtasks" rows="3" maxlength="4000"></textarea><div class="button-row"><button class="primary" type="submit">${selected ? "Aufgabe speichern" : "Aufgabe hinzufügen +"}</button><button id="task-cancel" class="outline-button" type="button">Leeren</button></div></form>`;
  const value = (id: string) => panel.querySelector<HTMLInputElement>(`#${id}`)!;
  value("task-title").value = selected?.title || ""; value("task-due").value = selected?.due || "";
  value("task-priority").value = selected?.priority || "mittel"; value("task-repeat").value = selected?.repeat || "keine";
  value("task-reminder").value = selected?.reminderAt || ""; value("task-subtasks").value = selected?.subtasks?.map((s) => s.title).join("\n") || "";
  panel.querySelector("#task-cancel")!.addEventListener("click", () => { editing = null; ctx.render(); });
  panel.querySelector("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = value("task-title").value.trim(); if (!title) return;
    const repeat = value("task-repeat").value as Task["repeat"]; const due = value("task-due").value || null;
    if (repeat !== "keine" && !due) return window.alert("Wiederkehrende Aufgaben brauchen einen Termin.");
    const titles = value("task-subtasks").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (titles.length > 30) return window.alert("Maximal 30 Unteraufgaben.");
    const subtasks = titles.map((t) => selected?.subtasks?.find((s) => s.title === t) || { id: crypto.randomUUID(), title: t, done: false });
    try {
      await ctx.changeData((next) => {
        const item = next.tasks.find((t) => t.id === editing);
        const fields = { title, due, repeat, repeatDay: due ? Number(due.slice(8, 10)) : undefined, subtasks, priority: value("task-priority").value as Priority, reminderAt: value("task-reminder").value };
        if (item) Object.assign(item, fields);
        else next.tasks.push({ ...fields, id: crypto.randomUUID(), done: false, status: "offen", createdAt: new Date().toISOString() });
      }); editing = null; ctx.render();
    } catch { window.alert("Aufgabe konnte nicht gespeichert werden."); }
  }); content.append(panel);
  const tools = el("div", "button-row wrap");
  for (const [v, label] of [["liste", "Liste"], ["kanban", "Kanban"], ["kalender", "Kalender"]]) {
    const b = el("button", v === view ? "primary" : "outline-button", label); b.onclick = () => { view = v; ctx.render(); }; tools.append(b);
  }
  const exportButton = el("button", "outline-button", "Kalender exportieren (.ics)");
  exportButton.onclick = () => downloadFile("allinone-aufgaben.ics", tasksCalendar(data.tasks), "text/calendar"); tools.append(exportButton); content.append(tools);
  const list = el("section", "panel list-panel");
  if (view === "kalender") {
    const month = el("input"); month.type = "month"; month.value = calendarMonth; month.setAttribute("aria-label", "Kalendermonat");
    month.onchange = () => { calendarMonth = month.value; ctx.render(); }; list.append(month);
    const days = new Date(Number(calendarMonth.slice(0, 4)), Number(calendarMonth.slice(5, 7)), 0).getDate();
    for (let day = 1; day <= days; day++) {
      const date = `${calendarMonth}-${String(day).padStart(2, "0")}`;
      const items = data.tasks.filter((t) => t.due === date);
      const group = el("div", `calendar-day ${date === localDate() ? "today" : ""}`); group.append(el("strong", "", `${day}.`));
      for (const t of items) group.append(taskRow(ctx, t));
      if (!items.length) group.append(el("small", "muted", "–")); list.append(group);
    }
    const undated = data.tasks.filter((t) => !t.due); if (undated.length) { list.append(el("h3", "", "Ohne Termin")); undated.forEach((t) => list.append(taskRow(ctx, t))); }
  } else if (view === "kanban") {
    const columns = el("div", "kanban-grid");
    for (const [status, label] of [["offen", "Offen"], ["in-arbeit", "In Arbeit"], ["erledigt", "Erledigt"]]) {
      const column = el("section", "kanban-column"); column.append(el("h3", "", label));
      data.tasks.filter((t) => (t.done ? "erledigt" : t.status || "offen") === status).forEach((t) => column.append(taskRow(ctx, t))); columns.append(column);
    } list.append(columns);
  } else {
    list.append(el("h2", "", `Deine Aufgaben (${data.tasks.length})`));
    [...data.tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || "9999").localeCompare(b.due || "9999")).forEach((t) => list.append(taskRow(ctx, t)));
  }
  if (!data.tasks.length) list.append(el("p", "empty", "Noch keine Aufgaben.")); content.append(list);
  content.append(el("p", "hint", "Erinnerungen erscheinen bei geöffneter, entsperrter App. Unter Einstellungen kannst du Browser-Mitteilungen aktivieren. Für Erinnerungen bei geschlossener App exportiere den Kalender."));
}
function taskRow(ctx: ViewContext, task: Task): HTMLElement {
  const { element: el } = ctx; const wrap = el("div", "advanced-task"); const row = el("div", `task-row ${task.done ? "done" : ""}`);
  const check = el("input"); check.type = "checkbox"; check.checked = task.done; check.setAttribute("aria-label", `Aufgabe ${task.title} abschließen`);
  check.onchange = () => void ctx.changeData((next) => completeTask(next, task.id, check.checked)).catch(() => window.alert("Speichern fehlgeschlagen."));
  const text = el("div", "task-text"); text.append(el("strong", "", task.title), el("small", "", `${task.due || "Ohne Termin"} · ${task.priority}${task.repeat && task.repeat !== "keine" ? ` · ${task.repeat}` : ""}`));
  const edit = el("button", "text-button", "Bearbeiten"); edit.onclick = () => { editing = task.id; ctx.render(); document.querySelector<HTMLInputElement>("#task-title")?.focus(); };
  const remove = el("button", "icon-button", "×"); remove.setAttribute("aria-label", `Aufgabe ${task.title} löschen`);
  remove.onclick = () => { if (window.confirm(`Aufgabe „${task.title}“ löschen?`)) void ctx.changeData((next) => { next.tasks = next.tasks.filter((t) => t.id !== task.id); }).catch(() => window.alert("Löschen fehlgeschlagen.")); };
  row.append(check, text, edit, remove); wrap.append(row);
  const status = el("select"); status.setAttribute("aria-label", `Status von ${task.title}`);
  for (const [value, label] of [["offen", "Offen"], ["in-arbeit", "In Arbeit"], ["erledigt", "Erledigt"]]) status.add(new Option(label, value));
  status.value = task.done ? "erledigt" : task.status || "offen";
  status.onchange = () => void ctx.changeData((next) => { completeTask(next, task.id, status.value === "erledigt"); next.tasks.find((t) => t.id === task.id)!.status = status.value as Task["status"]; }).catch(() => window.alert("Speichern fehlgeschlagen.")); wrap.append(status);
  for (const sub of task.subtasks || []) {
    const label = el("label", "subtask"); const input = el("input"); input.type = "checkbox"; input.checked = sub.done;
    input.onchange = () => void ctx.changeData((next) => { const s = next.tasks.find((t) => t.id === task.id)?.subtasks?.find((s) => s.id === sub.id); if (s) s.done = input.checked; }).catch(() => window.alert("Speichern fehlgeschlagen."));
    label.append(input, document.createTextNode(sub.title)); wrap.append(label);
  } return wrap;
}

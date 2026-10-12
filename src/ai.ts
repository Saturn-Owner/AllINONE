import type { ViewContext } from "./features";
export function renderAI(ctx: ViewContext): void {
  const { content, data, element: el } = ctx;
  content.append(ctx.heading("OPTIONALER HELFER", "KI-Assistent", "Ausgewählte Notizen zusammenfassen oder Aufgaben daraus vorschlagen."));
  const panel = el("section", "panel"); panel.append(el("p", "hint", "Verbinde einen eigenen Ollama-Dienst über die Serverkonfiguration. Übertragen wird nur die hier ausgewählte Notiz, nachdem du zustimmst. Passwörter, Finanzen und andere Notizen werden nicht mitgesendet."));
  const form = el("form"); form.innerHTML = '<label for="ai-note">Notiz freigeben</label><select id="ai-note" required></select><label for="ai-action">Aktion</label><select id="ai-action"><option value="summary">Zusammenfassen</option><option value="tasks">Aufgaben vorschlagen</option></select><label class="subtask"><input id="ai-consent" type="checkbox" required /> Ich gebe diese Notiz an meinen konfigurierten KI-Dienst frei.</label><button class="primary form-submit">KI-Anfrage starten</button>';
  const select = form.querySelector<HTMLSelectElement>("#ai-note")!;
  select.add(new Option("Notiz auswählen …", "")); data.notes.forEach((n) => select.add(new Option(n.title, n.id)));
  const preview = el("pre", "ai-note-preview"); select.onchange = () => { const note = data.notes.find((n) => n.id === select.value); preview.textContent = note ? `${note.title}\n\n${note.body}` : ""; form.querySelector<HTMLInputElement>("#ai-consent")!.checked = false; };
  const feedback = el("p", "message"); const result = el("div", "ai-result");
  form.onsubmit = async (event) => {
    event.preventDefault(); const note = data.notes.find((n) => n.id === select.value); if (!note || !ctx.isActive() || !form.querySelector<HTMLInputElement>("#ai-consent")!.checked) return;
    const button = form.querySelector<HTMLButtonElement>("button")!; button.disabled = true; feedback.className = "message"; feedback.textContent = "KI verarbeitet die freigegebene Notiz …"; result.replaceChildren();
    try {
      const action = form.querySelector<HTMLSelectElement>("#ai-action")!.value;
      const response = await fetch("/api/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, title: note.title, body: note.body, consent: true }), signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(90_000)]) });
      let value: { error?: string; text?: string }; try { value = await response.json(); } catch { throw new Error("Der KI-Dienst ist hier nicht verfügbar. Starte den AllINONE-Server mit Ollama-Konfiguration und melde dich unter Synchronisation an."); }
      if (!response.ok) throw new Error(value.error || "KI-Anfrage fehlgeschlagen.");
      const text = value.text || ""; if (!panel.isConnected) return;
      feedback.textContent = "Vorschlag erhalten. Prüfe den Inhalt vor dem Speichern.";
      if (action === "summary") {
        const output = el("textarea"); output.rows = 10; output.value = text; output.setAttribute("aria-label", "KI-Zusammenfassung bearbeiten"); result.append(output);
        const save = el("button", "primary", "Zusammenfassung als Notiz speichern"); save.onclick = async () => { const body = output.value.slice(0, 100000); save.disabled = true; try { await ctx.changeData((d) => d.notes.push({ id: crypto.randomUUID(), title: `${note.title} · Zusammenfassung`.slice(0, 160), body, updatedAt: new Date().toISOString(), tags: ["ki-vorschlag"] })); } catch { save.disabled = false; window.alert("Speichern fehlgeschlagen."); } }; result.append(save);
      } else {
        const input = el("textarea"); input.rows = 8; input.value = text.split("\n").map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 30).join("\n"); input.setAttribute("aria-label", "KI-Aufgaben bearbeiten"); result.append(el("p", "hint", "Eine Aufgabe pro Zeile. Entferne unerwünschte Vorschläge."), input);
        const save = el("button", "primary", "Geprüfte Aufgaben übernehmen"); save.onclick = async () => { const titles = input.value.split("\n").map((t) => t.trim()).filter(Boolean); if (!titles.length || titles.length > 30) return window.alert("Bitte 1 bis 30 Aufgaben eingeben."); save.disabled = true; try { await ctx.changeData((d) => { titles.forEach((title) => d.tasks.push({ id: crypto.randomUUID(), title: title.slice(0, 160), done: false, priority: "mittel", due: null, createdAt: new Date().toISOString() })); }); } catch { save.disabled = false; window.alert("Speichern fehlgeschlagen."); } }; result.append(save);
      }
    } catch (e) { feedback.textContent = e instanceof Error ? e.message : "KI-Anfrage fehlgeschlagen."; feedback.className = "message error"; }
    finally { button.disabled = false; }
  }; panel.append(form, preview, feedback, result); content.append(panel);
}

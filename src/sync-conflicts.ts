import type { ConnectContext } from "./connect";
import { getServerVault, putServerVault } from "./remote";
import { unlockVault, parseEnvelope, type VaultData, type VaultEnvelope } from "./vault";
import { saveBackup } from "./backups";
export async function renderConflictResolver(ctx: ConnectContext, passphrase: string, baseline: (revision: string | null, envelope: VaultEnvelope) => Promise<void>): Promise<void> {
  const { element: el } = ctx;
  const panel = el("section", "panel conflict-panel"); const feedback = el("p", "message"); panel.append(el("h2", "", "Synchronisationskonflikt lösen"), feedback); ctx.content.append(panel);
  try {
    if (!passphrase) throw new Error("Gib oben die Passphrase des Server-Tresors ein, um Versionen zu vergleichen.");
    const remote = await getServerVault(); if (!remote.envelope) throw new Error("Auf dem Server liegt kein Tresor.");
    const { data: serverData } = await unlockVault(remote.envelope, passphrase);
    if (!panel.isConnected) return;
    const localRaw = JSON.stringify(ctx.envelope);
    const local = structuredClone(ctx.data); const merged = structuredClone(local);
    panel.append(el("p", "hint", "Wähle für abweichende Einträge den lokalen oder den Server-Stand. Einträge, die nur auf einer Seite vorkommen, lassen sich behalten oder entfernen. Ohne gemeinsame Verlaufsversion ist nicht erkennbar, ob ein Eintrag neu oder auf dem anderen Gerät gelöscht wurde. Beide verschlüsselten Stände werden vor einer Änderung lokal gesichert."));
    const collections = ["tasks", "notes", "passwords", "accounts", "transactions", "recurring", "budgets"] as const;
    const names = { tasks: "Aufgabe", notes: "Notiz", passwords: "Zugang", accounts: "Konto", transactions: "Buchung", recurring: "Zahlung", budgets: "Budget" };
    const choices = new Map<string, string>();
    for (const collection of collections) {
      const left = (local[collection] || []) as { id: string; title?: string; name?: string; payee?: string; category?: string }[];
      const right = (serverData[collection] || []) as typeof left;
      const ids = [...new Set([...left, ...right].map((i) => i.id))];
      for (const id of ids) {
        const a = left.find((i) => i.id === id); const b = right.find((i) => i.id === id);
        if (a && b && JSON.stringify(a) === JSON.stringify(b)) continue;
        const row = el("div", "conflict-row"); row.append(el("strong", "", `${names[collection]}: ${(a || b)!.title || (a || b)!.name || (a || b)!.payee || (a || b)!.category || id}`));
        const select = el("select"); select.setAttribute("aria-label", `Auswahl ${collection} ${id}`);
        if (a) select.add(new Option("Lokalen Eintrag behalten", "local")); if (b) select.add(new Option("Server-Eintrag behalten", "remote")); select.add(new Option("Eintrag entfernen", "remove"));
        const key = `${collection}:${id}`; choices.set(key, select.value); select.onchange = () => choices.set(key, select.value);
        row.append(select);
        if (collection !== "passwords") {
          const details = el("details"); details.append(el("summary", "", "Unterschiede anzeigen"), el("pre", "server-output", `Lokal:\n${a ? JSON.stringify(a, null, 2) : "Nicht vorhanden"}\n\nServer:\n${b ? JSON.stringify(b, null, 2) : "Nicht vorhanden"}`)); row.append(details);
        } else row.append(el("p", "hint", "Die Passwortwerte werden hier nicht angezeigt. Wähle den gewünschten Stand bewusst."));
        panel.append(row);
      }
    }
    const prefs = el("select"); prefs.setAttribute("aria-label", "Einstellungen bei Konflikt"); prefs.add(new Option("Lokale Einstellungen behalten", "local")); prefs.add(new Option("Server-Einstellungen übernehmen", "remote")); panel.append(prefs);
    const apply = el("button", "primary", "Auswahl zusammenführen & synchronisieren");
    apply.onclick = async () => { apply.disabled = true; try {
      if (localStorage.getItem("allinone.vault.v1") !== localRaw) throw new Error("Lokale Daten haben sich geändert. Öffne den Vergleich erneut.");
      await saveBackup(localRaw); await saveBackup(JSON.stringify(remote.envelope));
      if (!panel.isConnected || localStorage.getItem("allinone.vault.v1") !== localRaw) throw new Error("Ansicht oder Tresor geändert. Öffne den Vergleich erneut.");
      for (const collection of collections) {
        const left = (local[collection] || []) as { id: string }[]; const right = (serverData[collection] || []) as { id: string }[];
        const ids = [...new Set([...left, ...right].map((i) => i.id))]; const items = ids.flatMap((id) => {
          const choice = choices.get(`${collection}:${id}`); if (choice === "remove") return [];
          const item = choice === "remote" ? right.find((i) => i.id === id) : left.find((i) => i.id === id) || right.find((i) => i.id === id); return item ? [item] : [];
        }); (merged as unknown as Record<string, unknown>)[collection] = items;
      }
      if (prefs.value === "remote") { if (serverData.preferences) merged.preferences = serverData.preferences; else delete merged.preferences; }
      const accountIds = new Set(merged.accounts.map((a) => a.id));
      if ([...merged.transactions, ...merged.recurring].some((t) => !accountIds.has(t.accountId))) throw new Error("Eine Buchung oder Zahlung braucht ein entferntes Konto. Behalte das Konto oder entferne die zugehörigen Einträge.");
      await ctx.changeData((d) => Object.assign(d, merged));
      const envelope = parseEnvelope(localStorage.getItem("allinone.vault.v1")!);
      const revision = await putServerVault(remote.revision, envelope); await baseline(revision, envelope); ctx.render();
    } catch (e) { if (!feedback.isConnected) window.alert(e instanceof Error ? e.message : "Konflikt bleibt bestehen. Lokaler Stand ist gespeichert."); else feedback.textContent = e instanceof Error ? e.message : "Konflikt konnte nicht gelöst werden."; apply.disabled = false; } };
    panel.append(apply); panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { feedback.textContent = e instanceof Error ? e.message : "Vergleich fehlgeschlagen."; feedback.className = "message error"; }
}

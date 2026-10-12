import { parseEnvelope, unlockVault, type PasswordEntry } from "../src/vault";
import { fillCredentials } from "./autofill";
declare const chrome: any;
let entries: PasswordEntry[] = [];
let timer = 0;
let epoch = 0;
const feedback = document.querySelector<HTMLElement>("#message")!;
const lock = document.querySelector<HTMLButtonElement>("#lock")!;
lock.onclick = () => { epoch++; document.querySelector<HTMLInputElement>("#pass")!.value = ""; window.clearTimeout(timer); entries = []; document.querySelector("#entries")!.replaceChildren(); document.querySelector<HTMLFormElement>("#unlock")!.hidden = false; lock.hidden = true; feedback.textContent = "Gesperrt."; };
document.querySelector<HTMLFormElement>("#unlock")!.onsubmit = async (event) => {
  event.preventDefault(); const button = document.querySelector<HTMLButtonElement>("#unlock button")!; button.disabled = true; const expectedEpoch = epoch;
  try {
    const file = document.querySelector<HTMLInputElement>("#file")!.files?.[0]; if (!file || file.size > 10_000_000) throw new Error("Gültige Sicherung auswählen (maximal 10 MB).");
    const pass = document.querySelector<HTMLInputElement>("#pass")!;
    const { data } = await unlockVault(parseEnvelope(await file.text()), pass.value); pass.value = "";
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const url = new URL(tab.url || "");
    if (url.protocol !== "https:") throw new Error("Autofill ist ausschließlich auf HTTPS-Websites erlaubt.");
    if (epoch !== expectedEpoch) return;
    entries = data.passwords.filter((p) => { try { return new URL(p.url).origin === url.origin; } catch { return false; } });
    feedback.textContent = `${url.origin}: ${entries.length} passende Zugänge. Prüfe die Adresse vor dem Ausfüllen.`;
    const list = document.querySelector("#entries")!; list.replaceChildren();
    entries.forEach((entry) => { const b = document.createElement("button"); b.textContent = `${entry.title} · ${entry.username} ausfüllen`; b.onclick = async () => {
      if (epoch !== expectedEpoch) return;
      b.disabled = true;
      try { const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: fillCredentials, args: [url.origin, entry.username, entry.password] }); if (epoch !== expectedEpoch) return; if (!results[0]?.result) throw new Error("Kein eindeutiges Login-Formular gefunden oder Adresse geändert. Bitte manuell ausfüllen."); feedback.textContent = "Ausgefüllt. Die Anmeldung musst du selbst bestätigen."; } catch (e) { feedback.textContent = e instanceof Error ? e.message : "Ausfüllen fehlgeschlagen."; } finally { b.disabled = false; }
    }; list.append(b); }); document.querySelector<HTMLFormElement>("#unlock")!.hidden = true; lock.hidden = false; window.clearTimeout(timer); timer = window.setTimeout(() => lock.click(), 120000);
  } catch (e) { feedback.textContent = e instanceof Error ? e.message : "Entsperren fehlgeschlagen."; }
  finally { document.querySelector<HTMLInputElement>("#pass")!.value = ""; button.disabled = false; }
};

import { balance, formatEuro, generatePassword, monthTotals, nextRecurringDate, parseEuro } from "./domain";
import type { RecurringPayment, VaultData } from "./vault";
import { validDate, localDate, reusedPasswords } from "./productivity";

export interface ViewContext {
  content: HTMLElement;
  data: VaultData;
  changeData: (update: (data: VaultData) => void) => Promise<void>;
  render: () => void;
  heading: (eyebrow: string, title: string, subtitle: string) => HTMLElement;
  element: <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, value?: string) => HTMLElementTagNameMap[K];
}

let editingPassword: string | null = null;
let passwordSearch = "";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Vorgang fehlgeschlagen.";
}

export function renderPasswords(ctx: ViewContext): void {
  const { content, data, element, heading } = ctx;
  content.append(heading("PASSWORTTRESOR", "Zugänge", "Zugangsdaten im verschlüsselten lokalen Tresor verwalten."));
  const notice = element("p", "security-notice", "Noch nicht unabhängig geprüft. Bitte keine wichtigen Konten hierher migrieren, bevor ein Security Review abgeschlossen ist.");
  content.append(notice);
  const reused = reusedPasswords(data);
  content.append(element("p", reused.size ? "security-notice" : "positive", reused.size ? `${reused.size} Zugänge verwenden ein mehrfach gespeichertes Passwort. Ersetze diese durch unterschiedliche Passwörter.` : "Keine mehrfach verwendeten Passwörter im Tresor erkannt."));
  const current = data.passwords.find((item) => item.id === editingPassword);
  const editor = element("section", "panel");
  editor.innerHTML = `<h2>${current ? "Zugang bearbeiten" : "Neuen Zugang speichern"}</h2>
    <form id="password-form" autocomplete="off">
      <div class="form-pair"><div><label for="pw-title">Bezeichnung</label><input id="pw-title" maxlength="160" required /></div><div><label for="pw-username">Benutzername oder E-Mail</label><input id="pw-username" maxlength="320" /></div></div>
      <label for="pw-password">Passwort</label><div class="inline-field"><input id="pw-password" type="password" maxlength="1024" required autocomplete="new-password" /><button id="generate-password" class="outline-button" type="button">Generieren</button><button id="toggle-password" class="outline-button" type="button">Anzeigen</button></div>
      <div class="form-pair"><div><label for="pw-url">Website (HTTPS)</label><input id="pw-url" type="url" placeholder="https://example.com" maxlength="2048" /></div><div><label for="pw-notes">Hinweis</label><input id="pw-notes" maxlength="1000" /></div></div>
      <div class="button-row"><button class="primary" type="submit">${current ? "Änderungen speichern" : "Zugang speichern"}</button><button id="pw-cancel" class="outline-button" type="button">Abbrechen</button></div>
    </form>`;
  editor.querySelector<HTMLInputElement>("#pw-title")!.value = current?.title || "";
  editor.querySelector<HTMLInputElement>("#pw-username")!.value = current?.username || "";
  editor.querySelector<HTMLInputElement>("#pw-password")!.value = current?.password || "";
  editor.querySelector<HTMLInputElement>("#pw-url")!.value = current?.url || "";
  editor.querySelector<HTMLInputElement>("#pw-notes")!.value = current?.notes || "";
  editor.querySelector<HTMLButtonElement>("#generate-password")!.addEventListener("click", () => {
    editor.querySelector<HTMLInputElement>("#pw-password")!.value = generatePassword();
    editor.querySelector<HTMLInputElement>("#pw-password")!.type = "text";
  });
  editor.querySelector<HTMLButtonElement>("#toggle-password")!.addEventListener("click", () => {
    const input = editor.querySelector<HTMLInputElement>("#pw-password")!;
    input.type = input.type === "password" ? "text" : "password";
  });
  editor.querySelector<HTMLButtonElement>("#pw-cancel")!.addEventListener("click", () => { editingPassword = null; ctx.render(); });
  editor.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = editor.querySelector<HTMLInputElement>("#pw-title")!.value.trim();
    const username = editor.querySelector<HTMLInputElement>("#pw-username")!.value.trim();
    const password = editor.querySelector<HTMLInputElement>("#pw-password")!.value;
    const url = editor.querySelector<HTMLInputElement>("#pw-url")!.value.trim();
    const notes = editor.querySelector<HTMLInputElement>("#pw-notes")!.value.trim();
    try {
      if (url && new URL(url).protocol !== "https:") throw new Error("Nur HTTPS-Websites sind erlaubt.");
      await ctx.changeData((next) => {
        const item = next.passwords.find((entry) => entry.id === editingPassword);
        if (item) Object.assign(item, { title, username, password, url, notes, updatedAt: new Date().toISOString() });
        else next.passwords.push({ id: crypto.randomUUID(), title, username, password, url, notes, updatedAt: new Date().toISOString() });
      });
      editingPassword = null;
      ctx.render();
    } catch (error) { window.alert(errorMessage(error)); }
  });
  content.append(editor);

  const list = element("section", "panel list-panel");
  const top = element("div", "panel-heading");
  top.append(element("h2", "", `Gespeicherte Zugänge (${data.passwords.length})`));
  const search = element("input") as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Zugänge suchen";
  search.setAttribute("aria-label", "Zugänge suchen");
  search.value = passwordSearch;
  search.addEventListener("input", () => {
    passwordSearch = search.value;
    renderPasswordRows(ctx, rows);
  });
  top.append(search);
  list.append(top);
  const rows = element("div", "item-list");
  list.append(rows);
  content.append(list);
  renderPasswordRows(ctx, rows);
}

function renderPasswordRows(ctx: ViewContext, rows: HTMLElement): void {
  rows.replaceChildren();
  const filtered = ctx.data.passwords.filter((item) => `${item.title} ${item.username}`.toLocaleLowerCase().includes(passwordSearch.toLocaleLowerCase()));
  if (!filtered.length) rows.append(ctx.element("p", "empty", "Keine passenden Zugänge."));
  const reused = reusedPasswords(ctx.data);
  for (const item of filtered) {
    const row = ctx.element("div", "credential-row");
    const info = ctx.element("div", "credential-info");
    info.append(ctx.element("strong", "", item.title), ctx.element("small", "", item.username || item.url || "Ohne Benutzername"));
    const secret = ctx.element("span", "secret-value", "••••••••••••");
    const show = ctx.element("button", "outline-button", "Anzeigen");
    let revealTimer = 0;
    show.addEventListener("click", () => {
      window.clearTimeout(revealTimer);
      const revealed = show.textContent === "Anzeigen";
      secret.textContent = revealed ? item.password : "••••••••••••";
      show.textContent = revealed ? "Verbergen" : "Anzeigen";
      if (revealed) revealTimer = window.setTimeout(() => { secret.textContent = "••••••••••••"; show.textContent = "Anzeigen"; }, 15000);
    });
    const copy = ctx.element("button", "outline-button", "Kopieren");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.password);
        copy.textContent = "Kopiert";
        window.setTimeout(async () => {
          try { if (await navigator.clipboard.readText() === item.password) await navigator.clipboard.writeText(""); } catch { /* clipboard permission may be revoked */ }
          copy.textContent = "Kopieren";
        }, 30000);
      } catch { window.alert("Zwischenablage nicht verfügbar. HTTPS oder localhost verwenden."); }
    });
    const edit = ctx.element("button", "text-button", "Bearbeiten");
    edit.addEventListener("click", () => { editingPassword = item.id; ctx.render(); });
    const remove = ctx.element("button", "text-button danger", "Löschen");
    remove.addEventListener("click", () => {
      if (window.confirm(`Zugang „${item.title}“ löschen?`)) {
        ctx.changeData((data) => { data.passwords = data.passwords.filter((entry) => entry.id !== item.id); })
          .catch((error) => window.alert(errorMessage(error)));
      }
    });
    if (reused.has(item.id)) info.append(ctx.element("small", "negative", "Passwort mehrfach verwendet"));
    row.append(info, secret, show, copy, edit, remove);
    rows.append(row);
  }
}

export function renderFinances(ctx: ViewContext): void {
  const { content, data, element, heading } = ctx;
  content.append(heading("FINANZEN", "Dein Geld im Blick.", "Konten, Buchungen und wiederkehrende Zahlungen manuell erfassen."));
  const month = localDate().slice(0, 7);
  const totals = monthTotals(data.transactions, month);
  const summary = element("div", "stats");
  for (const [amount, label] of [
    [data.accounts.reduce((sum, account) => sum + balance(account, data.transactions), 0), "Gesamtbestand"],
    [totals.income, "Einnahmen im Monat"],
    [-totals.expenses, "Ausgaben im Monat"]
  ] as const) {
    const card = element("div", "stat-card");
    card.append(element("strong", "", formatEuro(amount)), element("span", "", label));
    summary.append(card);
  }
  content.append(summary);

  const accountPanel = element("section", "panel");
  accountPanel.innerHTML = '<h2>Konten</h2><form id="account-form" class="form-pair"><div><label for="account-name">Name</label><input id="account-name" maxlength="100" required placeholder="z. B. Girokonto" /></div><div><label for="opening-balance">Anfangsbestand in €</label><input id="opening-balance" inputmode="decimal" value="0,00" required /></div><button class="primary" type="submit">Konto hinzufügen</button></form>';
  accountPanel.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = accountPanel.querySelector<HTMLInputElement>("#account-name")!.value.trim();
    const input = accountPanel.querySelector<HTMLInputElement>("#opening-balance")!.value.trim();
    try {
      const negative = input.startsWith("-");
      const cents = parseEuro(negative ? input.slice(1) : input) * (negative ? -1 : 1);
      await ctx.changeData((next) => next.accounts.push({ id: crypto.randomUUID(), name, openingBalanceCents: cents, currency: "EUR" }));
    } catch (error) { window.alert(errorMessage(error)); }
  });
  const accountRows = element("div", "item-list");
  for (const account of data.accounts) {
    const row = element("div", "finance-row");
    row.append(element("strong", "", account.name), element("span", "", formatEuro(balance(account, data.transactions))));
    const remove = element("button", "text-button danger", "Löschen");
    remove.addEventListener("click", () => {
      if (data.transactions.some((item) => item.accountId === account.id) || data.recurring.some((item) => item.accountId === account.id)) {
        window.alert("Dieses Konto hat Buchungen oder wiederkehrende Zahlungen. Entferne diese zuerst.");
      } else if (window.confirm(`Konto „${account.name}“ löschen?`)) {
        ctx.changeData((next) => { next.accounts = next.accounts.filter((item) => item.id !== account.id); })
          .catch((error) => window.alert(errorMessage(error)));
      }
    });
    row.append(remove);
    accountRows.append(row);
  }
  if (!data.accounts.length) accountRows.append(element("p", "empty", "Lege zuerst ein Konto an."));
  accountPanel.append(accountRows);
  content.append(accountPanel);

  if (!data.accounts.length) return;
  const txPanel = element("section", "panel");
  txPanel.innerHTML = '<h2>Neue Buchung</h2><form id="transaction-form"><div class="form-pair"><div><label for="tx-account">Konto</label><select id="tx-account"></select></div><div><label for="tx-kind">Art</label><select id="tx-kind"><option value="expense">Ausgabe</option><option value="income">Einnahme</option></select></div></div><div class="form-pair"><div><label for="tx-amount">Betrag in €</label><input id="tx-amount" inputmode="decimal" required placeholder="12,50" /></div><div><label for="tx-date">Datum</label><input id="tx-date" type="date" required /></div></div><div class="form-pair"><div><label for="tx-payee">Empfänger / Quelle</label><input id="tx-payee" maxlength="160" required /></div><div><label for="tx-category">Kategorie</label><input id="tx-category" maxlength="80" placeholder="z. B. Lebensmittel" /></div></div><label for="tx-note">Notiz</label><input id="tx-note" maxlength="500" /><button class="primary form-submit" type="submit">Buchung speichern</button></form>';
  const accountSelect = txPanel.querySelector<HTMLSelectElement>("#tx-account")!;
  for (const account of data.accounts) accountSelect.add(new Option(account.name, account.id));
  txPanel.querySelector<HTMLInputElement>("#tx-date")!.value = localDate();
  txPanel.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const amount = parseEuro(txPanel.querySelector<HTMLInputElement>("#tx-amount")!.value);
      if (!amount) throw new Error("Der Betrag muss größer als null sein.");
      const sign = txPanel.querySelector<HTMLSelectElement>("#tx-kind")!.value === "income" ? 1 : -1;
      await ctx.changeData((next) => next.transactions.push({
        id: crypto.randomUUID(), accountId: accountSelect.value, amountCents: amount * sign,
        date: txPanel.querySelector<HTMLInputElement>("#tx-date")!.value,
        payee: txPanel.querySelector<HTMLInputElement>("#tx-payee")!.value.trim(),
        category: txPanel.querySelector<HTMLInputElement>("#tx-category")!.value.trim(),
        note: txPanel.querySelector<HTMLInputElement>("#tx-note")!.value.trim(), updatedAt: new Date().toISOString()
      }));
    } catch (error) { window.alert(errorMessage(error)); }
  });
  content.append(txPanel);

  const txList = element("section", "panel");
  txList.append(element("h2", "", "Letzte Buchungen"));
  for (const item of [...data.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50)) {
    const row = element("div", "finance-row");
    const details = element("div", "credential-info");
    details.append(element("strong", "", item.payee), element("small", "", `${item.date} · ${item.category || "Ohne Kategorie"} · ${data.accounts.find((account) => account.id === item.accountId)?.name || "Gelöschtes Konto"}`));
    row.append(details, element("span", item.amountCents < 0 ? "negative" : "positive", formatEuro(item.amountCents)));
    const remove = element("button", "text-button danger", "Löschen");
    remove.addEventListener("click", () => {
      if (window.confirm(`Buchung „${item.payee}“ löschen?`)) ctx.changeData((next) => { next.transactions = next.transactions.filter((entry) => entry.id !== item.id); }).catch((error) => window.alert(errorMessage(error)));
    });
    row.append(remove);
    txList.append(row);
  }
  if (!data.transactions.length) txList.append(element("p", "empty", "Noch keine Buchungen."));
  content.append(txList);

  const recurringPanel = element("section", "panel");
  recurringPanel.innerHTML = '<h2>Wiederkehrende Zahlungen</h2><form id="recurring-form"><div class="form-pair"><div><label for="rec-account">Konto</label><select id="rec-account"></select></div><div><label for="rec-payee">Empfänger</label><input id="rec-payee" maxlength="160" required /></div></div><div class="form-pair"><div><label for="rec-amount">Monatlicher Betrag in €</label><input id="rec-amount" inputmode="decimal" required /></div><div><label for="rec-day">Tag im Monat (1–31)</label><input id="rec-day" type="number" min="1" max="31" value="1" required /></div></div><label for="rec-category">Kategorie</label><input id="rec-category" maxlength="80" /><label class="subtask"><input id="rec-subscription" type="checkbox" /> Als Abo verwalten</label><label for="rec-cancel">Kündigen bis</label><input id="rec-cancel" type="date" /><button class="primary form-submit" type="submit">Zahlung vormerken</button></form>';
  const recurringAccount = recurringPanel.querySelector<HTMLSelectElement>("#rec-account")!;
  for (const account of data.accounts) recurringAccount.add(new Option(account.name, account.id));
  recurringPanel.querySelector<HTMLFormElement>("form")!.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const amount = parseEuro(recurringPanel.querySelector<HTMLInputElement>("#rec-amount")!.value);
      if (!amount) throw new Error("Der Betrag muss größer als null sein.");
      await ctx.changeData((next) => next.recurring.push({ id: crypto.randomUUID(), accountId: recurringAccount.value,
        amountCents: amount, dayOfMonth: Number(recurringPanel.querySelector<HTMLInputElement>("#rec-day")!.value),
        payee: recurringPanel.querySelector<HTMLInputElement>("#rec-payee")!.value.trim(),
        category: recurringPanel.querySelector<HTMLInputElement>("#rec-category")!.value.trim(),
        active: true, subscription: recurringPanel.querySelector<HTMLInputElement>("#rec-subscription")!.checked, cancelBy: recurringPanel.querySelector<HTMLInputElement>("#rec-cancel")!.value, updatedAt: new Date().toISOString() }));
    } catch (error) { window.alert(errorMessage(error)); }
  });
  for (const payment of data.recurring) renderRecurringRow(ctx, recurringPanel, payment);
  if (!data.recurring.length) recurringPanel.append(element("p", "empty", "Noch keine monatlichen Zahlungen vorgemerkt."));
  content.append(recurringPanel);
}

function renderRecurringRow(ctx: ViewContext, panel: HTMLElement, payment: RecurringPayment): void {
  const row = ctx.element("div", "finance-row");
  const info = ctx.element("div", "credential-info");
  info.append(ctx.element("strong", "", payment.payee), ctx.element("small", "", `Nächster Termin: ${nextRecurringDate(payment)} · ${ctx.data.accounts.find((account) => account.id === payment.accountId)?.name || "Konto fehlt"}`));
  row.append(info, ctx.element("span", "negative", `−${formatEuro(payment.amountCents)}${payment.active ? "" : " · pausiert"}`));
  const toggle = ctx.element("button", "outline-button", payment.active ? "Pausieren" : "Aktivieren"); toggle.onclick = () => void ctx.changeData((d) => { const p = d.recurring.find((r) => r.id === payment.id); if (p) p.active = !p.active; }).catch((e) => window.alert(errorMessage(e))); row.append(toggle);
  const edit = ctx.element("button", "text-button", "Frist ändern"); edit.onclick = () => { const date = window.prompt("Kündigungsfrist (JJJJ-MM-TT, leer zum Entfernen)", payment.cancelBy || ""); if (date === null) return; if (date && !validDate(date)) return window.alert("Datum im Format JJJJ-MM-TT eingeben."); void ctx.changeData((d) => { const p = d.recurring.find((r) => r.id === payment.id); if (p) p.cancelBy = date; }).catch((e) => window.alert(errorMessage(e))); }; row.append(edit);
  const remove = ctx.element("button", "text-button danger", "Löschen");
  remove.addEventListener("click", () => {
    if (window.confirm(`Zahlung „${payment.payee}“ löschen?`)) ctx.changeData((data) => { data.recurring = data.recurring.filter((item) => item.id !== payment.id); }).catch((error) => window.alert(errorMessage(error)));
  });
  const subscription = ctx.element("button", "text-button", payment.subscription ? "Abo-Markierung entfernen" : "Als Abo markieren"); subscription.onclick = () => void ctx.changeData((d) => { const p = d.recurring.find((r) => r.id === payment.id); if (p) p.subscription = !p.subscription; }).catch((e) => window.alert(errorMessage(e))); row.append(subscription);
  row.append(remove);
  panel.append(row);
}

export function openPassword(id: string): void { editingPassword = id; passwordSearch = ""; }

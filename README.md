# AllINONE

Installierbare Web-App (PWA) für Dashboard, Aufgaben, Markdown-Notizen, Zugangsdaten, Finanzen und VPS-Verwaltung. Der Tresor wird im Browser verschlüsselt und liegt zunächst auf dem Gerät. Optional lassen sich verschlüsselte Versionen in Google Drive speichern oder mit dem eigenen Server zwischen Geräten synchronisieren.

**Sicherheitsstatus:** Funktionsfähiger Prototyp ohne unabhängiges Security Review. Bitte noch keine wichtigen Passwörter, SSH-Schlüssel oder Bankzugänge darin verwalten. „Unknackbar“ kann keine Software garantieren.

## Lokal starten

Für einen lokalen Test ohne Node.js enthält `downloads/AllINONE-Linux-Test.zip` die gebaute App und einen Python-Starter. Das ZIP vollständig entpacken, im Ordner `AllINONE-Linux-Test` ein Terminal öffnen und `python3 starten.py` ausführen. Der Browser öffnet `http://localhost:4175/`; das Terminal während des Testens offen lassen. Dieses Paket enthält die lokale Oberfläche. Mit `npm run package:linux` lässt es sich nach Änderungen neu bauen.

Node.js 24 ist erforderlich (siehe `.node-version`).

```bash
npm ci
npm run dev
```

Die von Vite angezeigte Adresse öffnen. Für die installierbare Fassung `npm run build && npm run preview` ausführen. Die Installation erfolgt im Browser über „App installieren“ beziehungsweise „Zum Startbildschirm hinzufügen“. PWA und Web Crypto benötigen HTTPS oder `localhost`. Lokale Nutzung erfordert keinen Serverzugang; alle Tresordaten liegen verschlüsselt in `localStorage`. Regelmäßig eine verschlüsselte JSON-Sicherung exportieren.

## Funktionen

- Dashboard mit Aufgaben, Fälligkeiten, Notizen, Zugangszahl und Kontostand.
- Aufgaben mit Priorität, Termin und Erledigt-Status.
- Markdown-Notizen mit Vorschau, Suche, Wiki-Links und Rückverweisen, Wissensgraph, Markdown-Import und ZIP-Export. Die Vorschau filtert aktiven HTML-Inhalt. Obsidian selbst und seine Plugins sind nicht eingebettet.
- Passworttresor mit Zufallsgenerator, Suche, Bearbeitung und zeitlich begrenzter Anzeige. Kein Browser-Autofill und kein unabhängiges Audit.
- Finanzkonten, Buchungen, Monatsübersicht und wiederkehrende Zahlungen. Keine Bankanbindung.
- Verschlüsselte JSON-Sicherung zum Importieren und Exportieren.
- Verschlüsselte Synchronisation über den eigenen Server mit automatischem Hochladen, periodischem Abruf und Konfliktschutz. Das erste Koppeln eines weiteren Geräts erfolgt bewusst über „Vom Server herunterladen“. Gleichzeitige Änderungen werden nicht automatisch zusammengeführt.
- Google-Drive-Versionen im versteckten App-Datenbereich. Das Hochladen und Wiederherstellen erfolgt bewusst per Klick; dazu ist eine eigene öffentliche OAuth Client-ID erforderlich.
- VPS-Status sowie SFTP-Dateiliste, Upload und Download über einen serverseitig freigegebenen SSH-Host. Kein frei ausführbares Terminal; Uploads sind auf 10 MB begrenzt.

## Eigener Server mit Docker

1. Eine HTTPS-Domain auf den VPS zeigen lassen. In `Caddyfile.example` die Domain ersetzen und Caddy als TLS-Reverse-Proxy vor Port 4174 betreiben. Der App-Port bleibt auf `127.0.0.1` gebunden.
2. Die Server-Passphrase ohne Shell-Verlauf hashen:

   ```bash
   read -rs -p 'Server-Passphrase: ' aio_password
   printf '%s' "$aio_password" | npm run --silent server:hash-password
   unset aio_password
   printf '\n'
   ```

   Den ausgegebenen scrypt-Hash als `APP_PASSWORD_HASH` verwenden. Die Server-Passphrase sollte sich von der Tresor-Passphrase unterscheiden.
3. Eine lokale `.env` mit `PUBLIC_ORIGIN=https://deine-domain.example` und `APP_PASSWORD_HASH='scrypt$...'` anlegen. Die einfachen Anführungszeichen verhindern eine Interpolation der Dollarzeichen im Hash. `.env` ist von Git und Docker-Build ausgeschlossen. Den Hash nicht in das Repository schreiben.
4. `docker compose -f compose.example.yml up --build -d` ausführen. Das Volume `allinone-data` regelmäßig sichern. Der Server speichert ausschließlich die verschlüsselte Tresordatei; er kennt die Tresor-Passphrase nicht.
5. In der App unter „Synchronisation“ mit der Server-Passphrase anmelden und den verschlüsselten Tresor hochladen. Auf einem weiteren Gerät lokal einen vorläufigen Tresor erstellen, am Server anmelden und den vorhandenen Tresor mit dessen Passphrase herunterladen.

Ohne Docker: `npm ci && npm run build`, dann `PUBLIC_ORIGIN`, `APP_PASSWORD_HASH` und optional `DATA_DIR` setzen und `npm run server` starten. `PUBLIC_ORIGIN` muss HTTPS sein; HTTP ist nur für `localhost`/`127.0.0.1` erlaubt.

### VPS-Verwaltung aktivieren

`hosts.example.json` nach `config/hosts.json` kopieren und Hostname, Benutzer, freigegebenes `rootPath`, Pfad zum privaten SSH-Schlüssel und **verifizierten** Host-Fingerprint eintragen. Den Fingerprint außerhalb dieser App prüfen. Einen eigens angelegten SSH-Benutzer mit minimalen Rechten und ein getrenntes Schlüsselpaar verwenden. Schlüssel nur unter `keys/` auf dem Server ablegen; keinesfalls im Browser oder Git. Beide Verzeichnisse sind ignoriert. Dann zusätzlich `-f compose.ssh.example.yml` beim Compose-Aufruf angeben. Die SSH-Hostkonfiguration darf nur vom Serverbetreiber bearbeitet werden.

## Google Drive einrichten

In der Google Cloud Console die Drive API aktivieren, einen OAuth-Client vom Typ „Webanwendung“ erstellen und die HTTPS-Adresse der App als autorisierten JavaScript-Ursprung hinterlegen. Den OAuth-Zustimmungsbildschirm und Testnutzer einrichten. Die **öffentliche** Client-ID im Bereich „Synchronisation“ eingeben oder beim Build über `VITE_GOOGLE_CLIENT_ID` setzen. Kein Client Secret in die Web-App eintragen. Die App fordert nur den Scope `drive.appdata` an. Ohne OAuth-Konfiguration läuft der lokale Tresor weiter.

## Prüfen

```bash
npm test
npm run test:server
npm run test:ui
npm run test:ui:server
npm run test:ui:drive
npm run test:ssh
npm run build
```

Die UI-Tests benötigen Chromium (`CHROMIUM_PATH` kann den Pfad angeben). `test:ssh` benötigt ein lokales OpenSSH-`sshd` und prüft SFTP gegen einen temporären Host. Der Drive-Test verwendet eine simulierte Google-API und ersetzt keinen Live-Test mit echter OAuth-Konfiguration.

## Sicherheitsgrenzen

Der lokale Tresor nutzt PBKDF2-SHA-256 mit 600.000 Runden und AES-256-GCM. Die App sperrt sich nach 15 Minuten ohne Eingabe. Der Browser hält den abgeleiteten Schlüssel bis zum Sperren im Arbeitsspeicher. Der Server schützt seine Sitzung zusätzlich mit scrypt-Hash, HttpOnly-Cookie, Origin-Prüfung und Anmelderate-Limit; er kann die Tresordaten nicht entschlüsseln. Eine kompromittierte App-Auslieferung, ein manipuliertes Gerät oder bösartige Browser-Erweiterungen können dennoch Klartext beim Entsperren abgreifen. Eine verlorene Tresor-Passphrase lässt sich nicht zurücksetzen. Details stehen in [ARCHITECTURE.md](ARCHITECTURE.md).

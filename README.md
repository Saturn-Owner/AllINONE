# AllINONE

Installierbare Web-App (PWA) für Dashboard, Aufgaben, Markdown-Notizen, Zugangsdaten, Finanzen und VPS-Verwaltung. Der Tresor wird im Browser verschlüsselt und liegt zunächst auf dem Gerät. Optional lassen sich verschlüsselte Versionen in Google Drive speichern oder mit dem eigenen Server zwischen Geräten synchronisieren.

**Sicherheitsstatus:** Funktionsfähiger Prototyp ohne unabhängiges Security Review. Bitte noch keine wichtigen Passwörter, SSH-Schlüssel oder Bankzugänge darin verwalten. „Unknackbar“ kann keine Software garantieren.

## Lokal starten

Für einen lokalen Test ohne Node.js enthält `downloads/AllINONE-Linux-Test.zip` die gebaute App und einen Python-Starter. Das ZIP vollständig entpacken, im Ordner `AllINONE-Linux-Test` ein Terminal öffnen und `python3 starten.py` ausführen. Der Browser öffnet `http://localhost:4175/`; das Terminal während des Testens offen lassen. Dieses Paket enthält die lokale Oberfläche. Mit `npm run package:linux` lässt es sich nach Änderungen neu bauen.

### Linux-Testpaket aktualisieren

Die laufende Vorschau mit **Strg+C** beenden. Im entpackten Ordner mit `starten.py` einmalig den Aktualisierer für ein älteres Paket installieren:

```bash
curl -fL https://raw.githubusercontent.com/Saturn-Owner/AllINONE/main/scripts/update-preview.py -o aktualisieren.py && python3 aktualisieren.py
```

Danach reicht für jedes weitere Update:

```bash
python3 aktualisieren.py
```

Der Befehl liest die aktuelle Paketversion auf `main` und lädt das dazugehörige Archiv mit einem eindeutigen Dateinamen samt SHA-256-Prüfsumme. Ein unverändertes Paket wird nicht erneut installiert. Ungültige Pakete ersetzen keine Dateien; bei einem Fehler während des Ersetzens wird der alte Dateistand wiederhergestellt. Die Prüfsumme prüft die Unversehrtheit, sie ist keine unabhängige Signatur. Updates vertrauen dem Code im Repository. Python 3 und Internetzugang reichen für den Aktualisierer.

Anschließend `python3 starten.py` ausführen und die Browserseite neu laden. Denselben Browser, dasselbe Profil und **`http://localhost:4175/`** weiterverwenden: Der verschlüsselte Tresor liegt im Browser und wird vom Update nicht bearbeitet. Vor Updates eine verschlüsselte Sicherung exportieren. Ein Wechsel zu `127.0.0.1`, einem anderen Port oder einem anderen Browserprofil verwendet einen anderen lokalen Speicher.

Bei Änderungen der App vor dem Veröffentlichen `npm run package:linux` ausführen und **`downloads/` gemeinsam** mit dem Quellcode committen. Vorhandene Archive unter `downloads/versions/` erhalten: So funktionieren Updates auch während einer gleichzeitig veröffentlichten neuen Version. Der Build erzeugt eine eigene Offline-Cache-Version, damit die installierte PWA neue App-Dateien lädt.

### Entwicklung mit Node.js

Node.js 24 ist erforderlich (siehe `.node-version`).

```bash
npm ci
npm run dev
```

Die von Vite angezeigte Adresse öffnen. Für die installierbare Fassung `npm run build && npm run preview` ausführen. Die Installation erfolgt im Browser über „App installieren“ beziehungsweise „Zum Startbildschirm hinzufügen“. PWA und Web Crypto benötigen HTTPS oder `localhost`. Lokale Nutzung erfordert keinen Serverzugang; alle Tresordaten liegen verschlüsselt in `localStorage`. Regelmäßig eine verschlüsselte JSON-Sicherung exportieren.

## Funktionen in Version 0.2

- Dashboard mit frei wählbaren und umsortierbaren Aufgaben-, Notiz- und Zahlungswidgets, Kennzahlen und Schnelleingabe.
- Globale Suche nach Aufgaben, vollständigen Notizinhalten, Tags, Zugangsbezeichnungen und Finanzbuchungen. Passwortwerte werden nicht durchsucht. `Strg+K` / `Cmd+K` fokussiert die Suche.
- Aufgaben mit Priorität, Unteraufgaben, Termin, Bearbeitungsstatus, Wiederholungen, Liste, Kanban und Monatskalender. Abschließen erzeugt die nächste wiederkehrende Aufgabe; erneutes Abschließen desselben Eintrags erzeugt keine zweite Kopie. Kalenderexport als `.ics`.
- Erinnerungen und Kündigungsfristen in der App sowie optionale Browser-Mitteilungen. Sie funktionieren **nur bei geöffneter, entsperrter App**. Für geschlossene Apps die Aufgaben in eine Kalender-App exportieren und dort Erinnerungen einstellen.
- Markdown-Notizen mit Vorschau, Wiki-Links, Rückverweisen, Graph, Suche im vollständigen Inhalt, Ordnern, Tags und Vorlagen. Je Notiz bis zu 20 frühere Textversionen. Anhänge bis 2 MB pro Datei und 3 MB pro Notiz; PNG/JPEG/WebP/GIF können angezeigt werden. Browser-Speicher ist begrenzt: Schlägt das Speichern fehl, bleibt der vorherige Tresor erhalten. Markdown-ZIP exportiert Text; die verschlüsselte Gesamtsicherung enthält zusätzlich Anhänge und Historie. Obsidian-Plugins sind nicht eingebettet.
- Passworttresor mit Generator, Suche, Bearbeitung, zeitlich begrenzter Anzeige, Kopieren und Erkennung mehrfach verwendeter Passwörter. Unter Einstellungen: Download der Chromium-Autofill-Erweiterung.
- Konten, Buchungen, Monatsauswertungen nach Kategorien und Monatsbudgets. CSV-Import mit Vorschau, Validierung und Duplikaterkennung; CSV-Export. Monatliche Zahlungen können als Abo markiert, pausiert und mit Kündigungsfristen versehen werden.
- Automatische verschlüsselte Sicherungsstände in IndexedDB: letzte 20 unterschiedliche Stände je Tresor. Einstellungen bieten Export und Wiederherstellung; frühere Tresore lassen sich ebenfalls einblenden. Eine beschädigte aktuelle Datei wird vor dem Ersetzen als unveränderte Rohkopie gesichert. Auch bei gesperrtem Tresor lässt sich die aktuelle verschlüsselte Datei herunterladen. **Browser-Sicherungen ersetzen keine Kopie außerhalb des Geräts.**
- Synchronisation mit eigenem Server: automatischer Upload, Abruf, sichtbarer Status, Revisionsschutz und Vergleich von lokalen/Server-Einträgen mit bewusster Auswahl. Beide Stände werden vor der Zusammenführung gesichert. Eintrag nur auf einer Seite: ausdrücklich entscheiden, ob neu oder gelöscht; ohne gemeinsamen Änderungsverlauf ist das nicht automatisch bestimmbar.
- Google-Drive-Versionen im `appDataFolder` nach OAuth-Einrichtung. Upload und Wiederherstellung weiterhin bewusst per Klick.
- Gespeicherte serverseitige VPS-Verbindungen mit gepinnten SSH-Schlüsseln, Status und SFTP. Linux-Monitoring für CPU, RAM und Speicher alle 60 Sekunden bei geöffneter VPS-Ansicht, Warnungen ab 90 % und bei Verbindungsfehlern. Kein Hintergrund-Monitoring bei geschlossener App.
- Optionaler KI-Assistent über einen eigenen Ollama-Dienst: eine ausgewählte Notiz freigeben, Zusammenfassung oder Aufgaben vorschlagen lassen, vor dem Speichern bearbeiten. Keine automatische Ausführung und kein Zugriff auf den Passworttresor.
- PWA-Installation, Offline-Nutzung, Startbildschirm-Verknüpfungen für Aufgabe/Notiz sowie „Teilen an AllINONE“ auf unterstützten Browsern (z. B. installierte PWA unter Android/Chrome). Geteilte Inhalte werden nach dem Entsperren erst auf Bestätigung gespeichert.
- Entsperranimation mit Rücksicht auf „Bewegung reduzieren“. Einstellbare automatische Sperre von 1–120 Minuten.

### Vorhandene Daten nach dem Update

Tresore in Format 1 und 2 lassen sich mit dem bisherigen Passwort öffnen. Beim nächsten Speichern wird Format 3 verwendet. **Alle Geräte auf Version 0.2 aktualisieren**, bevor sie gemeinsam synchronisieren: Alte App-Versionen können das neue Datenformat nicht bearbeiten. Das Linux-Update bearbeitet keine Browserdaten; Browser, Profil und `http://localhost:4175/` beibehalten.

### Browser-Autofill installieren

Unter **Einstellungen → Browser-Erweiterung herunterladen** das ZIP herunterladen, entpacken und in Chrome/Chromium/Edge unter `chrome://extensions` bzw. `edge://extensions` den Entwicklermodus einschalten und „Entpackte Erweiterung laden“ wählen. Den entpackten Ordner auswählen.

Eine aktuelle verschlüsselte JSON-Sicherung aus AllINONE exportieren. Auf der gewünschten HTTPS-Website das Erweiterungssymbol anklicken, die Sicherung auswählen und im Popup entsperren. Nur Zugänge mit exakt derselben Origin (Protokoll, Host und Port) werden angeboten. Ein Klick füllt ein eindeutiges Login-Formular; die Anmeldung wird nicht abgeschickt. Mehrdeutige Formulare, eingebettete Frames und Registrierungspasswörter werden nicht ausgefüllt. Das Popup speichert keine Passwörter dauerhaft und sperrt nach zwei Minuten. Nach einer Änderung im Haupttresor eine neue Sicherung verwenden. Keine native Handy-Autofill-Integration; Firefox wird von diesem Erweiterungspaket nicht unterstützt.

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
4. `docker compose -f compose.example.yml up --build -d` ausführen. Das Volume `allinone-data` regelmäßig sichern. Der Server speichert die Tresordatei ausschließlich verschlüsselt; er kennt die Tresor-Passphrase nicht. Eine ausdrücklich an die KI freigegebene Notiz wird für diese Anfrage als Klartext verarbeitet.
5. In der App unter „Synchronisation“ mit der Server-Passphrase anmelden und den verschlüsselten Tresor hochladen. Auf einem weiteren Gerät lokal einen vorläufigen Tresor erstellen, am Server anmelden und den vorhandenen Tresor mit dessen Passphrase herunterladen.

Ohne Docker: `npm ci && npm run build`, dann `PUBLIC_ORIGIN`, `APP_PASSWORD_HASH` und optional `DATA_DIR` setzen und `npm run server` starten. `PUBLIC_ORIGIN` muss HTTPS sein; HTTP ist nur für `localhost`/`127.0.0.1` erlaubt.

### VPS-Verwaltung aktivieren

`hosts.example.json` nach `config/hosts.json` kopieren und Hostname, Benutzer, freigegebenes `rootPath`, Pfad zum privaten SSH-Schlüssel und **verifizierten** Host-Fingerprint eintragen. Den Fingerprint außerhalb dieser App prüfen. Einen eigens angelegten SSH-Benutzer mit minimalen Rechten und ein getrenntes Schlüsselpaar verwenden. Schlüssel nur unter `keys/` auf dem Server ablegen; keinesfalls im Browser oder Git. Beide Verzeichnisse sind ignoriert. Dann zusätzlich `-f compose.ssh.example.yml` beim Compose-Aufruf angeben. Die SSH-Hostkonfiguration darf nur vom Serverbetreiber bearbeitet werden.

## Eigene KI mit Ollama einrichten

Auf einem selbst kontrollierten Rechner Ollama installieren, starten und ein Modell laden, z. B. `ollama pull llama3.2`. Ollama nicht ungeschützt ins Internet stellen. Der AllINONE-Server muss den Dienst erreichen können.

In der Serverumgebung zusätzlich setzen:

```bash
AIO_OLLAMA_URL=http://127.0.0.1:11434
AIO_OLLAMA_MODEL=llama3.2
```

Bei Docker verweist `127.0.0.1` auf den AllINONE-Container. Verwende dort die interne Adresse eines Ollama-Containers oder eines erreichbaren eigenen Hosts. Die Variablen werden von `compose.example.yml` übernommen. Die URL wird ausschließlich vom Serverbetreiber festgelegt; die App hat kein Feld für beliebige KI-Endpunkte.

In AllINONE unter Synchronisation am eigenen Server anmelden, dann **KI-Assistent** öffnen. Vor jeder Anfrage eine Notiz wählen und der Übertragung zustimmen. Nur Titel und Text dieser Notiz werden im Arbeitsspeicher an Ollama weitergegeben; Anhänge und andere Tresorinhalte werden ausgeschlossen. Den Vorschlag prüfen und erst danach speichern. Die reine Python-Vorschau enthält keinen KI-Backenddienst.

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
python3 -m unittest discover -s tests -p 'test_updater.py'
npm run build
```

Die UI-Tests benötigen Chromium (`CHROMIUM_PATH` kann den Pfad angeben). `test:ssh` benötigt ein lokales OpenSSH-`sshd` und prüft SFTP gegen einen temporären Host. Die Autofill-Prüfung führt das ausgelieferte Popup und Ausfüllskript im Browser aus; die Chrome-API wird adaptiert, da die Cloud-Browserrichtlinie das Laden eigener Erweiterungen verbietet. Eine echte Erweiterungsinstallation ist lokal zusätzlich zu prüfen. Der Drive-Test verwendet eine simulierte Google-API und ersetzt keinen Live-Test mit echter OAuth-Konfiguration.

## Sicherheitsgrenzen

Der lokale Tresor nutzt PBKDF2-SHA-256 mit 600.000 Runden und AES-256-GCM. Die App sperrt sich standardmäßig nach 15 Minuten ohne Eingabe; unter Einstellungen sind 1–120 Minuten wählbar. Der Browser hält den abgeleiteten Schlüssel bis zum Sperren im Arbeitsspeicher. Der Server schützt seine Sitzung zusätzlich mit scrypt-Hash, HttpOnly-Cookie, Origin-Prüfung und Anmelderate-Limit; er kann die Tresordaten nicht entschlüsseln. Eine kompromittierte App-Auslieferung, ein manipuliertes Gerät oder bösartige Browser-Erweiterungen können dennoch Klartext beim Entsperren abgreifen. Eine verlorene Tresor-Passphrase lässt sich nicht zurücksetzen. Details stehen in [ARCHITECTURE.md](ARCHITECTURE.md) und [SECURITY.md](SECURITY.md).

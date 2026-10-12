# Architektur und Sicherheitsgrenzen

## Komponenten

- **PWA:** Vite/TypeScript, Web Crypto, lokaler verschlüsselter Tresor, Service Worker für App-Dateien und Offline-Nutzung. API-Antworten werden niemals im Offline-Cache gespeichert.
- **Datenschema:** Aufgaben, Notizen, Zugangsdaten, Finanzkonten, Buchungen und wiederkehrende Zahlungen teilen einen versionierten Tresor. Die Verschlüsselung verwendet einen zufälligen Salt je Tresor und einen neuen AES-GCM-Nonce je Speicherung. Formate 1 und 2 werden beim Entsperren als Format 3 eingelesen; erst Speichern schreibt den erweiterten Inhalt. Alte Clients lehnen Format 3 ab, statt neue Felder zu entfernen.
- **Eigener Server:** Node.js-Dienst für statische Dateien, Anmeldung, verschlüsselte Tresordatei und SSH-Gateway. Schreibvorgänge nutzen eine Revision als Vorbedingung und eine atomare Dateiumbenennung; Konflikte ergeben HTTP 409.
- **Google Drive:** OAuth Token Client im Browser; Versionen der verschlüsselten Tresorhülle liegen im `appDataFolder`. Drive ist Versionsspeicher, keine transaktionale Datenbank. Ein Merge konkurrierender Änderungen ist nicht implementiert.
- **VPS-Gateway:** Fest konfigurierte SSH-Hosts und gepinnte Host-Fingerprints. Der Server bietet feste Statusbefehle und SFTP innerhalb eines freigegebenen Stammverzeichnisses. Pfad- und Symlink-Ausbrüche werden geprüft; kein beliebiger Shell-Befehl aus der Oberfläche.

## Bedrohungsmodell

Die Verschlüsselung schützt einen gespeicherten Tresor vor einfachem Lesen auf dem Gerät, dem VPS oder in Drive, solange die Tresor-Passphrase geheim und stark ist. Die Server-Passphrase schützt den API-Zugang. Beide Passphrasen sollen verschieden sein. TLS und ein kontrollierter Auslieferungsweg sind für einen öffentlichen VPS nötig. Der Serverbetreiber kontrolliert den ausgelieferten JavaScript-Code und könnte ihn ändern; damit endet die Ende-zu-Ende-Vertraulichkeit. Auch Schadsoftware, Browser-Erweiterungen und kompromittierte Betriebssysteme können Daten beim Entsperren lesen. PBKDF2 erschwert Offline-Raten, ersetzt aber keine starke Passphrase.

Die App ist ein einzelner persönlicher Tresor, kein Mehrbenutzersystem. Aktive Server-Sitzungen liegen im Arbeitsspeicher und enden nach 12 Stunden oder einem Neustart. Konflikte lassen sich nach dem Entschlüsseln durch eine Auswahl pro Eintrag lösen; es gibt keinen automatischen Dreiwege-Merge und keine automatische Erkennung von Löschungen ohne gemeinsame Basis. Mobile und Desktop-Installation erfolgt als PWA; es gibt keine nativen signierten Pakete. Google OAuth und ein realer VPS müssen mit den späteren Zugangsdaten gesondert getestet werden.

Vor einer produktiven Nutzung als Passwortmanager oder für sensible Finanzen sind ein unabhängiges Code-Review, Penetrationstests, Update- und Backup-Prozesse sowie gegebenenfalls zusätzliche Anmeldefaktoren nötig. Ein Versprechen „KI-sicher“ oder „unknackbar“ wäre technisch unbegründet.

## Erweiterungen in Version 0.2

- **Sicherungen:** IndexedDB speichert ausschließlich verschlüsselte Hüllen, Salt, Zeit und Zufalls-ID. Serialisierte Schreibvorgänge halten 20 Stände pro Salt. Lokaler Browser-Storage bleibt der Haupttresor. Vor Import/Wiederherstellung muss die aktuelle Sicherung gelingen; normale Änderungen bleiben bei einem Backup-Fehler möglich und zeigen den Fehler an. Außerhalb des Browsers exportierte Dateien bleiben notwendig.
- **Notizen:** Text-Historie bleibt innerhalb der Verschlüsselung. Anhänge werden als Base64 gespeichert; Vorschaubilder erlauben ausschließlich PNG/JPEG/WebP/GIF, andere Dateien werden heruntergeladen. Markdown enthält keine aktiven Bilder oder HTML-Skripte.
- **Erinnerungen:** Prüfung nur im entsperrten Frontend; keine Serverkopie der Termine und kein Hintergrund-Push. Der `.ics`-Export übergibt Aufgaben an einen Kalender.
- **Autofill:** Das MV3-Paket wird aus derselben Tresorimplementierung gebaut. Es importiert eine verschlüsselte Datei, entschlüsselt im Popup und hält passende Einträge nur im Popup-Speicher. `activeTab`/`scripting`, keine allgemeinen Host-Berechtigungen. Funktion prüft Origin beim Ausfüllen erneut, Hauptframe und eindeutiges Passwortfeld. Kein Form-Submit. Zwei Minuten Popup-Sperre; Datei muss nach Tresoränderungen neu exportiert werden.
- **KI:** Authentifizierter, Origin-geschützter `/api/ai`-Endpunkt. Ollama-Adresse ist nur serverseitige Konfiguration. Nur ausdrücklich freigegebener Titel/Text, begrenzte Antwort und Zeitlimit. Keine Werkzeuge, keine Aktionen und keine automatische Übernahme. Betreiber des KI-Diensts erhält diesen Inhalt im Klartext.
- **Monitoring:** Feste Linux-Befehle mit Ausgabe- und Zeitlimit liefern strukturierte CPU-/RAM-/Dateisystemwerte. Prüfung jede Minute in der aktiven VPS-Ansicht; keine permanenten Hintergrundalarme.

## Schutz gegen parallele Vorgänge (0.2.1)

Lokale Änderungen und Wiederherstellungen verwenden Web Locks pro Ursprung sowie einen Vergleich mit der zuvor gelesenen Tresorhülle. Ein Sitzungszähler verwirft Ergebnisse, die nach Sperren oder einem Tresorwechsel eintreffen. Entwürfe werden während lokaler Darstellungsänderungen im Arbeitsspeicher erhalten; Sperren verwirft sie. Eine laufende automatische Übernahme prüft Entwürfe nochmals unmittelbar vor der Speicherung.

Automatische und manuelle Servervorgänge teilen eine Warteschlange und einen eigenen Web Lock. Eine im Browser gespeicherte Koppelgeneration verhindert, dass eine verspätete Antwort die Synchronisation nach einer Wiederherstellung in einem anderen Fenster erneut aktiviert. Revisionsprüfung auf dem Server bleibt zusätzlich erforderlich. HTTP-Timeouts und Abbruchsignale begrenzen veraltete Anfragen.

Backup-Auswahl, Einfügen und Aufräumen erfolgen in einer einzelnen IndexedDB-Schreibtransaktion; damit gilt die Grenze von 20 Ständen auch zwischen Browserfenstern. Metadaten enthalten eine monotone Reihenfolge, um Sicherungen aus derselben Millisekunde eindeutig zu sortieren.

# Architektur und Sicherheitsgrenzen

## Komponenten

- **PWA:** Vite/TypeScript, Web Crypto, lokaler verschlüsselter Tresor, Service Worker für App-Dateien und Offline-Nutzung. API-Antworten werden niemals im Offline-Cache gespeichert.
- **Datenschema:** Aufgaben, Notizen, Zugangsdaten, Finanzkonten, Buchungen und wiederkehrende Zahlungen teilen einen versionierten Tresor. Die Verschlüsselung verwendet einen zufälligen Salt je Tresor und einen neuen AES-GCM-Nonce je Speicherung. Alte Version-1-Tresore für Aufgaben und Notizen werden beim Entsperren migriert.
- **Eigener Server:** Node.js-Dienst für statische Dateien, Anmeldung, verschlüsselte Tresordatei und SSH-Gateway. Schreibvorgänge nutzen eine Revision als Vorbedingung und eine atomare Dateiumbenennung; Konflikte ergeben HTTP 409.
- **Google Drive:** OAuth Token Client im Browser; Versionen der verschlüsselten Tresorhülle liegen im `appDataFolder`. Drive ist Versionsspeicher, keine transaktionale Datenbank. Ein Merge konkurrierender Änderungen ist nicht implementiert.
- **VPS-Gateway:** Fest konfigurierte SSH-Hosts und gepinnte Host-Fingerprints. Der Server bietet feste Statusbefehle und SFTP innerhalb eines freigegebenen Stammverzeichnisses. Pfad- und Symlink-Ausbrüche werden geprüft; kein beliebiger Shell-Befehl aus der Oberfläche.

## Bedrohungsmodell

Die Verschlüsselung schützt einen gespeicherten Tresor vor einfachem Lesen auf dem Gerät, dem VPS oder in Drive, solange die Tresor-Passphrase geheim und stark ist. Die Server-Passphrase schützt den API-Zugang. Beide Passphrasen sollen verschieden sein. TLS und ein kontrollierter Auslieferungsweg sind für einen öffentlichen VPS nötig. Der Serverbetreiber kontrolliert den ausgelieferten JavaScript-Code und könnte ihn ändern; damit endet die Ende-zu-Ende-Vertraulichkeit. Auch Schadsoftware, Browser-Erweiterungen und kompromittierte Betriebssysteme können Daten beim Entsperren lesen. PBKDF2 erschwert Offline-Raten, ersetzt aber keine starke Passphrase.

Die App ist ein einzelner persönlicher Tresor, kein Mehrbenutzersystem. Aktive Server-Sitzungen liegen im Arbeitsspeicher und enden nach 12 Stunden oder einem Neustart. Ein Konflikt wird gemeldet, aber noch nicht automatisch aufgelöst. Mobile und Desktop-Installation erfolgt als PWA; es gibt keine nativen signierten Pakete. Google OAuth und ein realer VPS müssen mit den späteren Zugangsdaten gesondert getestet werden.

Vor einer produktiven Nutzung als Passwortmanager oder für sensible Finanzen sind ein unabhängiges Code-Review, Penetrationstests, Update- und Backup-Prozesse sowie gegebenenfalls zusätzliche Anmeldefaktoren nötig. Ein Versprechen „KI-sicher“ oder „unknackbar“ wäre technisch unbegründet.

# Sicherheitsstatus

AllINONE ist ein Funktionsprototyp. Es liegt **kein unabhängiges Audit und kein Penetrationstest** vor. Ein eigenes Code Review, Testprogramm und eine Abhängigkeitsprüfung ersetzen das nicht. Die interne Prüfung in Version 0.2.1 ist in [CODE_REVIEW.md](CODE_REVIEW.md) dokumentiert. Für sensible produktive Daten ist eine externe Prüfung erforderlich.

## Bereits umgesetzt

- Lokaler Tresor mit Web Crypto: PBKDF2-SHA-256 (600.000 Runden), zufälligem Salt und AES-256-GCM mit neuem IV pro Speicherung. Die Erweiterungen ändern weder die Passphrase noch diese Verfahren.
- Datenformat 3 liest frühere Formate 1 und 2. Alte App-Versionen können Format 3 nicht bearbeiten; damit werden neue Felder nicht stillschweigend entfernt. Alle Geräte vor gemeinsamer Nutzung aktualisieren.
- Automatische Sperre (1–120 Minuten), Sperren bei Änderungen aus einem anderen Browserfenster, kein dauerhaft gespeicherter Klartextschlüssel. Ergebnisse abgelaufener Sitzungen werden verworfen; Web-Crypto-Rechenvorgänge selbst können nicht rückwirkend abgebrochen werden.
- Verschlüsselte Browser-Sicherungen vor dem Überschreiben; eine Wiederherstellung braucht die Passphrase. Bei fehlendem Sicherungsspeicher erscheint eine Fehlermeldung. Lokale Änderungen können weiter gespeichert werden; Importe und Wiederherstellungen ersetzen den bestehenden Tresor erst nach erfolgreicher Sicherung.
- Origin-Prüfung, HttpOnly-/SameSite-Cookies, Anmelderate-Limit, Begrenzung gleichzeitiger Passwortprüfungen, vollständige Prüfung der verschlüsselten Hülle und Revisionsprüfung am Server. Die Prüfung der Hülle kann ohne Passphrase die Authentizität des verschlüsselten Inhalts nicht bestätigen.
- Autofill nur nach ausdrücklichem Klick, auf exakt derselben HTTPS-Origin und nur im Hauptframe bei einem eindeutigen Login-Formular. Keine allgemeine Website-Berechtigung, kein automatisches Absenden, kein Klartext in Extension-Storage. Nach zwei Minuten oder beim Schließen des Popups ist erneutes Entsperren erforderlich.
- KI bekommt nur die ausdrücklich ausgewählte Notiz; keine Zugangsdaten, Konten oder übrigen Notizen. Vorschläge werden als Text angezeigt und erfordern eine weitere Auswahl zum Speichern. Der Betreiber des KI-Diensts kann diese freigegebene Notiz lesen.
- SSH-Verbindungen sind fest freigegeben und prüfen Host-Fingerprints. Monitoring verwendet ausschließlich feste Befehle; Dateioperationen prüfen das freigegebene Verzeichnis.

## Grenzen und noch erforderliche Prüfungen

- Schadsoftware oder manipuliertes JavaScript kann einen entsperrten Tresor lesen. Starke Passphrasen, vertrauenswürdige Geräte, HTTPS und kontrollierte Updates sind erforderlich.
- Browser-Sicherungen liegen auf demselben Gerät wie der Tresor und verschwinden beim Löschen der Browserdaten. Zusätzlich Dateien außerhalb des Browsers sichern und die Wiederherstellung testen.
- Eine vergessene Passphrase kann nicht zurückgesetzt werden. Passwörter nie im Chat oder im Repository hinterlegen.
- Autofill und Erinnerungen sind keine native Android-/iOS-Passwortmanager-Integration. Erweiterungsinstallation, PWA-Teilen und Mitteilungen hängen vom Betriebssystem und Browser ab.
- Der KI-Server wird vom Betreiber über Umgebungsvariablen festgelegt. Keine beliebigen URLs aus dem Browser; keine KI-Werkzeuge, SSH-Aktionen oder automatische Übernahme von Vorschlägen.
- Extern prüfen lassen: Kryptografie und Schlüsselverwaltung, XSS/CSP, Extension-Berechtigungen und Phishing-Grenzen, Synchronisationsrennen, Wiederherstellung, API/SSH-Abgrenzung und Auslieferungskette. Prüfdatum und Ergebnisse nach einem echten Audit dokumentieren.

## Schwachstelle melden

Keine echten Tresore, Passphrasen oder SSH-Schlüssel veröffentlichen. Ein Problem mit Testdaten und nachvollziehbaren Schritten melden. Für vertrauliche Meldungen zuerst einen privaten Kontaktweg mit dem Repository-Betreiber vereinbaren.

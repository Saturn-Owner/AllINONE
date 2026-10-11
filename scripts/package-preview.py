"""Package the built app and a Python launcher for local Linux testing."""

from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
dist = root / "dist"
if not (dist / "index.html").is_file():
    raise SystemExit("Bitte zuerst npm run build ausführen.")
output = root / "downloads" / "AllINONE-Linux-Test.zip"
output.parent.mkdir(exist_ok=True)
instructions = """AllINONE lokal ausprobieren

1. Das gesamte ZIP entpacken.
2. Im entpackten Ordner ein Terminal öffnen.
3. Diesen Befehl ausführen:

   python3 starten.py

Die App öffnet sich im Browser. Falls das nicht automatisch passiert,
http://localhost:4175/ im Browser öffnen. Das Terminal offen lassen.
Mit Strg+C wird die Vorschau beendet.

Voraussetzung: Python 3. Es ist keine npm-Installation erforderlich.
Die App speichert den verschlüsselten Tresor im lokalen Browser.
Dieses Paket enthält die lokale Vorschau. Google Drive benötigt eine
eigene OAuth Client-ID; Serversynchronisation und VPS-Verwaltung
benötigen zusätzlich den AllINONE-Server.
Bitte Testdaten verwenden: Der Passworttresor wurde noch nicht
unabhängig auf Sicherheit geprüft.
"""
with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write(root / "scripts" / "start-preview.py", "AllINONE-Linux-Test/starten.py")
    archive.writestr("AllINONE-Linux-Test/SO_STARTET_DIE_APP.txt", instructions)
    for path in sorted(dist.rglob("*")):
        if path.is_file():
            archive.write(path, "AllINONE-Linux-Test/app/" + path.relative_to(dist).as_posix())
print(output)

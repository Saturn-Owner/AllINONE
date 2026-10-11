"""Package the built app and a Python launcher for local Linux testing."""

from pathlib import Path
import hashlib
import json
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

Aktualisieren: Zuerst die laufende App mit Strg+C beenden, dann:

   python3 aktualisieren.py

Danach mit python3 starten.py erneut starten und die Browserseite neu laden.
Verwende weiterhin denselben Browser und http://localhost:4175/.
Dein verschlüsselter Tresor bleibt im Browser erhalten.

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
files = {
    "starten.py": (root / "scripts" / "start-preview.py").read_bytes(),
    "aktualisieren.py": (root / "scripts" / "update-preview.py").read_bytes(),
    "SO_STARTET_DIE_APP.txt": instructions.encode(),
}
for path in sorted(dist.rglob("*")):
    if path.is_file():
        files["app/" + path.relative_to(dist).as_posix()] = path.read_bytes()
digest = hashlib.sha256()
package_version = json.loads((root / "package.json").read_text())["version"]
digest.update(package_version.encode() + b"\0")
for name, data in sorted(files.items()):
    digest.update(name.encode() + b"\0" + len(data).to_bytes(8, "big") + data)
build = digest.hexdigest()
version = {"format": 1, "version": package_version, "build": build}
files["version.json"] = (json.dumps(version, indent=2) + "\n").encode()
with zipfile.ZipFile(output, "w") as archive:
    for name, data in sorted(files.items()):
        entry = zipfile.ZipInfo("AllINONE-Linux-Test/" + name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
payload = output.read_bytes()
archive_name = f"versions/{build}.zip"
archive_path = output.parent / archive_name
archive_path.parent.mkdir(exist_ok=True)
archive_path.write_bytes(payload)
manifest = {**version, "archive": archive_name, "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)}
(output.parent / "linux-latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(output)

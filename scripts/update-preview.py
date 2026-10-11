"""Update an extracted AllINONE Linux package without touching browser data."""

import hashlib
import fcntl
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

REPOSITORY = "Saturn-Owner/AllINONE"
MAX_PACKAGE_BYTES = 50_000_000
ROOT_FILES = ("starten.py", "aktualisieren.py", "SO_STARTET_DIE_APP.txt", "version.json")


class RecoveryError(OSError):
    pass


def download(url, limit):
    request = urllib.request.Request(url, headers={"User-Agent": "AllINONE-Linux-Updater", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Die heruntergeladene Datei ist zu groß.")
    return data


def latest_source():
    return f"https://raw.githubusercontent.com/{REPOSITORY}/main"


def extract_package(payload, destination, expected_build):
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        entries = archive.infolist()
        if len(entries) > 10_000 or sum(item.file_size for item in entries) > MAX_PACKAGE_BYTES:
            raise ValueError("Das Update-Paket ist zu groß.")
        seen = set()
        for item in entries:
            path = PurePosixPath(item.filename)
            if ("\\" in item.filename or path.is_absolute() or ".." in path.parts
                    or len(path.parts) < 2 or path.parts[0] != "AllINONE-Linux-Test"
                    or path.as_posix() != item.filename.rstrip("/")
                    or stat.S_ISLNK(item.external_attr >> 16) or item.filename in seen):
                raise ValueError("Ungültiger Dateipfad im Update-Paket.")
            seen.add(item.filename)
            relative = Path(*path.parts[1:])
            if not (relative.parts[0] == "app" or relative.as_posix() in ROOT_FILES):
                raise ValueError("Unerwartete Datei im Update-Paket.")
            target = destination / relative
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(archive.read(item))
    if not (destination / "app" / "index.html").is_file() or any(not (destination / name).is_file() for name in ROOT_FILES):
        raise ValueError("Das Update-Paket ist unvollständig.")
    if json.loads((destination / "version.json").read_text())["build"] != expected_build:
        raise ValueError("Die Version im Paket stimmt nicht mit dem Download überein.")


def install_files(installation, candidate, backup):
    changed = []
    try:
        for name in ("app", *ROOT_FILES):
            target = installation / name
            previous = backup / name
            if target.is_symlink():
                raise ValueError("Verknüpfungen im Installationsordner werden nicht überschrieben.")
            had_previous = target.exists()
            if had_previous:
                os.replace(target, previous)
            changed.append((target, previous, had_previous))
            os.replace(candidate / name, target)
    except Exception:
        failures = []
        for target, previous, had_previous in reversed(changed):
            try:
                if target.is_dir():
                    shutil.rmtree(target)
                elif target.exists():
                    target.unlink()
                if had_previous:
                    os.replace(previous, target)
            except OSError as error:
                failures.append(error)
        if failures:
            raise RecoveryError(f"Die Rücksicherung konnte nicht abgeschlossen werden. Alte Dateien bleiben unter {backup} erhalten.")
        raise


def update(installation, source):
    if not (installation / "app" / "index.html").is_file() or not (installation / "starten.py").is_file():
        raise ValueError("Bitte aktualisieren.py im entpackten Ordner mit starten.py ausführen.")
    manifest = json.loads(download(f"{source}/downloads/linux-latest.json?update={time.time_ns()}", 16_384))
    if not isinstance(manifest, dict):
        raise ValueError("Ungültige Update-Informationen.")
    expected_hash = manifest.get("sha256", "")
    build = manifest.get("build", "")
    size = manifest.get("size")
    archive_path = manifest.get("archive")
    if (not isinstance(expected_hash, str) or not isinstance(build, str)
            or not re.fullmatch(r"[0-9a-f]{64}", expected_hash) or not re.fullmatch(r"[0-9a-f]{64}", build)
            or not isinstance(size, int) or not 0 < size <= MAX_PACKAGE_BYTES
            or archive_path != f"versions/{build}.zip"):
        raise ValueError("Ungültige Update-Informationen.")
    try:
        current = json.loads((installation / "version.json").read_text())
    except (OSError, ValueError):
        current = {}
    if isinstance(current, dict) and current.get("build") == build:
        return False
    payload = download(f"{source}/downloads/{archive_path}", MAX_PACKAGE_BYTES)
    if len(payload) != size or hashlib.sha256(payload).hexdigest() != expected_hash:
        raise ValueError("Die Prüfsumme stimmt nicht. Die vorhandene Version bleibt erhalten.")
    stage = Path(tempfile.mkdtemp(prefix=".allinone-update-", dir=installation))
    preserve_backup = False
    try:
        candidate = stage / "new"
        backup = stage / "previous"
        candidate.mkdir()
        backup.mkdir()
        extract_package(payload, candidate, build)
        install_files(installation, candidate, backup)
    except RecoveryError:
        preserve_backup = True
        raise
    finally:
        if not preserve_backup:
            shutil.rmtree(stage)
    return True


def main():
    installation = Path(__file__).resolve().parent
    try:
        with (installation / ".allinone-update.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ValueError("In diesem Ordner läuft bereits ein Update.")
            with socket.socket() as probe:
                probe.settimeout(0.5)
                if probe.connect_ex(("127.0.0.1", 4175)) == 0:
                    raise ValueError("Bitte die laufende App im anderen Terminal mit Strg+C beenden und das Update erneut starten.")
            print("Prüfe die aktuelle AllINONE-Version auf GitHub ...", flush=True)
            changed = update(installation, latest_source())
        print("AllINONE wurde aktualisiert." if changed else "Du hast bereits die aktuelle Version.")
        print("Starten: python3 starten.py")
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        raise SystemExit(f"Update fehlgeschlagen: {error}")


if __name__ == "__main__":
    main()

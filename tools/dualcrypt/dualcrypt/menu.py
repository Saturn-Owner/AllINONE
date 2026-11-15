"""Interaktives Menü (startet, wenn `dualcrypt` ohne Befehl aufgerufen wird)."""

from __future__ import annotations

import sys
from pathlib import Path

from . import __version__
from .actions import run_decrypt, run_encrypt
from .core import SUFFIX, default_decrypted_name, default_encrypted_name
from .crypto import DualCryptError

BANNER = f"""
╔══════════════════════════════════════╗
║  dualcrypt {__version__:<26}║
║  Zahlenfolge + Geheimwort            ║
╚══════════════════════════════════════╝"""


def _input(prompt: str) -> str:
    try:
        return input(prompt).strip()
    except EOFError:
        raise KeyboardInterrupt from None


def _clean(text: str) -> Path:
    """Anführungszeichen (Drag&Drop) entfernen, ~ auflösen."""
    return Path(text.strip("'\"")).expanduser()


def _choose_path(title: str, candidates: list[Path]) -> Path | None:
    """Nummer aus der Liste wählen oder Pfad tippen. Leere Eingabe = zurück."""
    print(f"\n{title}")
    for i, c in enumerate(candidates, 1):
        print(f"  {i}) {c.name}{'/' if c.is_dir() else ''}")
    hint = "Nummer oder Pfad" if candidates else "Pfad"
    while True:
        raw = _input(f"{hint} (leer = zurück): ")
        if not raw:
            return None
        if raw.isdigit() and candidates:
            idx = int(raw)
            if 1 <= idx <= len(candidates):
                return candidates[idx - 1]
            print("Ungültige Nummer.")
            continue
        p = _clean(raw)
        if p.exists():
            return p
        print(f"'{p}' nicht gefunden.")


def _ask_yes(question: str) -> bool:
    return _input(f"{question} [j/N]: ").lower() in ("j", "ja", "y", "yes")


def _ask_output(default: Path, what: str) -> tuple[Path, bool] | None:
    """Zielname bestätigen oder ändern; bei vorhandenem Ziel nach Überschreiben fragen."""
    raw = _input(f"{what} [{default}] (Enter = übernehmen, 0 = zurück): ")
    if raw == "0":
        return None
    target = _clean(raw) if raw else default
    force = False
    if target.exists():
        if not _ask_yes(f"'{target}' existiert bereits. Überschreiben?"):
            return None
        force = True
    return target, force


def _encrypt_flow() -> None:
    cwd = Path.cwd()
    items = sorted(
        (p for p in cwd.iterdir() if not p.name.startswith(".") and p.suffix != SUFFIX),
        key=lambda p: (not p.is_dir(), p.name.lower()),
    )[:30]
    src = _choose_path("Was soll verschlüsselt werden?", items)
    if src is None:
        return
    res = _ask_output(default_encrypted_name(src.resolve()), "Ausgabedatei")
    if res:
        run_encrypt(src, *res)


def _decrypt_flow() -> None:
    cwd = Path.cwd()
    items = sorted(cwd.glob(f"*{SUFFIX}"), key=lambda p: p.name.lower())[:30]
    src = _choose_path("Welche Datei soll entschlüsselt werden?", items)
    if src is None:
        return
    if not src.is_file():
        raise DualCryptError("Bitte eine .dcr-Datei wählen, keinen Ordner.")
    res = _ask_output(default_decrypted_name(src.resolve()), "Zielordner")
    if res:
        run_decrypt(src, *res)


def _info() -> None:
    print(
        "\nSo funktioniert's:\n"
        "  • Zum Verschlüsseln brauchst du eine Zahlenfolge UND ein Geheimwort.\n"
        "  • Beides wird per Tastatur abgefragt und nicht angezeigt.\n"
        "  • Zum Entschlüsseln brauchst du genau dieselben zwei Eingaben.\n"
        "  • Vergessen = Daten für immer weg. Das Original wird nie gelöscht."
    )


MENU = [
    ("Verschlüsseln (Datei oder Ordner)", _encrypt_flow),
    ("Entschlüsseln (.dcr-Datei)", _decrypt_flow),
    ("Hilfe", _info),
]


def run() -> int:
    print(BANNER)
    while True:
        print("\nWas möchtest du tun?")
        for i, (label, _) in enumerate(MENU, 1):
            print(f"  {i}) {label}")
        print("  0) Beenden")
        try:
            choice = _input("Auswahl: ")
            if choice in ("0", "q", "Q"):
                print("Tschüss!")
                return 0
            if choice.isdigit() and 1 <= int(choice) <= len(MENU):
                try:
                    MENU[int(choice) - 1][1]()
                except DualCryptError as exc:
                    print(f"Fehler: {exc}", file=sys.stderr)
            else:
                print("Bitte eine Zahl aus dem Menü eingeben.")
        except KeyboardInterrupt:
            print("\nTschüss!")
            return 0

"""Kommandozeile: dualcrypt encrypt|decrypt."""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

from . import __version__
from .core import decrypt_file, default_decrypted_name, default_encrypted_name, encrypt_path
from .crypto import DualCryptError


def _ask(confirm: bool) -> tuple[str, str]:
    """Geheimnisse nur interaktiv abfragen – nie als Argument (Shell-History, `ps`)."""
    zahlen = getpass.getpass("Zahlenfolge: ").strip()
    if not zahlen.isdigit():
        raise DualCryptError("Die Zahlenfolge darf nur aus Ziffern bestehen.")
    wort = getpass.getpass("Geheimwort:  ")
    if confirm:
        if getpass.getpass("Zahlenfolge (nochmal): ").strip() != zahlen or getpass.getpass(
            "Geheimwort (nochmal):  "
        ) != wort:
            raise DualCryptError("Eingaben stimmen nicht überein.")
        if len(zahlen) < 8:
            print("Warnung: Zahlenfolge unter 8 Ziffern ist leicht zu erraten.", file=sys.stderr)
        if len(wort) < 10:
            print("Warnung: Geheimwort unter 10 Zeichen ist schwach – besser eine Passphrase.", file=sys.stderr)
    return zahlen, wort


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="dualcrypt",
        description="Dateien und ganze Ordner mit Zahlenfolge + Geheimwort verschlüsseln "
        "(scrypt + AES-256-GCM).",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command", required=True)

    e = sub.add_parser("encrypt", aliases=["enc"], help="Datei/Ordner verschlüsseln")
    e.add_argument("pfad", type=Path, help="Datei oder Ordner")
    e.add_argument("-o", "--out", type=Path, help="Ausgabedatei (Standard: <pfad>.dcr)")
    e.add_argument("-f", "--force", action="store_true", help="Vorhandenes Ziel überschreiben")

    d = sub.add_parser("decrypt", aliases=["dec"], help=".dcr-Datei entschlüsseln")
    d.add_argument("datei", type=Path, help="Verschlüsselte .dcr-Datei")
    d.add_argument("-o", "--out", type=Path, help="Zielordner (Standard: <name>_entschluesselt)")
    d.add_argument("-f", "--force", action="store_true", help="Vorhandenes Ziel überschreiben")
    return p


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command in ("encrypt", "enc"):
            target = args.out or default_encrypted_name(args.pfad.resolve())
            zahlen, wort = _ask(confirm=True)
            print("Verschlüssele …")
            encrypt_path(args.pfad, target, zahlen, wort, force=args.force)
            print(f"Fertig: {target}")
        else:
            target = args.out or default_decrypted_name(args.datei.resolve())
            zahlen, wort = _ask(confirm=False)
            print("Entschlüssele …")
            decrypt_file(args.datei, target, zahlen, wort, force=args.force)
            print(f"Fertig: {target}")
    except DualCryptError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nAbgebrochen.", file=sys.stderr)
        return 130
    return 0

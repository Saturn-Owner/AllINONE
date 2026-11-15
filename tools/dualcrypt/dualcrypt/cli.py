"""Kommandozeile: dualcrypt encrypt|decrypt."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, menu
from .actions import run_decrypt, run_encrypt
from .crypto import DualCryptError


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="dualcrypt",
        description="Dateien und ganze Ordner mit Zahlenfolge + Geheimwort verschlüsseln "
        "(scrypt + AES-256-GCM). Ohne Befehl startet ein Auswahlmenü.",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = p.add_subparsers(dest="command")

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
        if args.command is None:
            return menu.run()
        if args.command in ("encrypt", "enc"):
            run_encrypt(args.pfad, args.out, args.force)
        else:
            run_decrypt(args.datei, args.out, args.force)
    except DualCryptError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nAbgebrochen.", file=sys.stderr)
        return 130
    return 0

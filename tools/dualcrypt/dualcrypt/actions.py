"""Gemeinsame Abläufe für Kommandozeile und Menü (Eingabe der Geheimnisse, Meldungen)."""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

from .core import decrypt_file, default_decrypted_name, default_encrypted_name, encrypt_path
from .crypto import DualCryptError


def ask_secrets(confirm: bool) -> tuple[str, str]:
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
            print(
                "Warnung: Geheimwort unter 10 Zeichen ist schwach – besser eine Passphrase.",
                file=sys.stderr,
            )
    return zahlen, wort


def run_encrypt(path: Path, out: Path | None, force: bool) -> Path:
    target = out or default_encrypted_name(path.resolve())
    zahlen, wort = ask_secrets(confirm=True)
    print("Verschlüssele …")
    encrypt_path(path, target, zahlen, wort, force=force)
    print(f"Fertig: {target}")
    return target


def run_decrypt(file: Path, out: Path | None, force: bool) -> Path:
    target = out or default_decrypted_name(file.resolve())
    zahlen, wort = ask_secrets(confirm=False)
    print("Entschlüssele …")
    decrypt_file(file, target, zahlen, wort, force=force)
    print(f"Fertig: {target}")
    return target

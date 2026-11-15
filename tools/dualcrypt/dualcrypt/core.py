"""Hochebene: Pfad verschlüsseln / Datei entschlüsseln (atomar, ohne Halbfertiges)."""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

from . import archive
from .crypto import DEFAULT_LOG2_N, DecryptReader, DualCryptError, EncryptWriter

SUFFIX = ".dcr"


def default_encrypted_name(source: Path) -> Path:
    return source.with_name(source.name + SUFFIX)


def default_decrypted_name(enc: Path) -> Path:
    if enc.name.endswith(SUFFIX) and len(enc.name) > len(SUFFIX):
        return enc.with_name(enc.name[: -len(SUFFIX)] + "_entschluesselt")
    return enc.with_name(enc.name + "_entschluesselt")


def _check_target(target: Path, force: bool) -> None:
    if target.exists() or target.is_symlink():
        if not force:
            raise DualCryptError(f"'{target}' existiert bereits (mit --force überschreiben).")


def encrypt_path(
    source: Path,
    target: Path,
    zahlen: str,
    wort: str,
    *,
    force: bool = False,
    log2_n: int = DEFAULT_LOG2_N,
) -> None:
    source = source.resolve()
    if not source.exists():
        raise DualCryptError(f"'{source}' nicht gefunden.")
    target = target.absolute()
    if target.is_dir() and not target.is_symlink():
        raise DualCryptError(f"Ziel '{target}' ist ein Ordner.")
    if source.is_dir() and target.resolve().is_relative_to(source):
        raise DualCryptError("Die Ausgabedatei darf nicht im zu verschlüsselnden Ordner liegen.")
    _check_target(target, force)

    fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=".dcr-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as out:
            with EncryptWriter(out, zahlen, wort, log2_n=log2_n) as enc:
                archive.pack(source, enc)
        os.replace(tmp_name, target)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def decrypt_file(
    enc_file: Path,
    target: Path,
    zahlen: str,
    wort: str,
    *,
    force: bool = False,
) -> None:
    if not enc_file.is_file():
        raise DualCryptError(f"'{enc_file}' nicht gefunden.")
    target = target.absolute()
    _check_target(target, force)

    # In ein temporäres Verzeichnis entpacken; erst nach vollständiger Prüfung verschieben.
    tmp_dir = Path(tempfile.mkdtemp(dir=target.parent, prefix=".dcr-"))
    try:
        with enc_file.open("rb") as fh:
            reader = DecryptReader(fh, zahlen, wort)
            archive.unpack(reader, tmp_dir)
            reader.drain()
        if target.is_symlink() or target.is_file():
            target.unlink()
        elif target.exists():
            shutil.rmtree(target)
        tmp_dir.rename(target)
    except BaseException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

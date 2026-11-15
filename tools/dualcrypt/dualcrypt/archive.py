"""Ordner/Dateien <-> TAR-Strom, mit sicherem Entpacken."""

from __future__ import annotations

import tarfile
from pathlib import Path
from typing import BinaryIO

from .crypto import DualCryptError


def pack(source: Path, sink: BinaryIO) -> None:
    """Schreibt `source` (Datei oder Ordner) als TAR-Strom in `sink`.

    Der oberste Name bleibt erhalten, entpackt entsteht also wieder `<name>/...`.
    """
    with tarfile.open(fileobj=sink, mode="w|", format=tarfile.PAX_FORMAT) as tar:
        tar.add(source, arcname=source.name, recursive=True)


def unpack(src: BinaryIO, dest: Path) -> None:
    """Entpackt den TAR-Strom nach `dest` (muss existieren).

    `filter="data"` blockiert absolute Pfade, `..`, Links nach außen,
    Geräte-/Sonderdateien und gefährliche Rechte.
    """
    try:
        with tarfile.open(fileobj=src, mode="r|") as tar:
            tar.extractall(dest, filter="data")
    except tarfile.FilterError as exc:
        raise DualCryptError(f"Unsicherer Archivinhalt blockiert: {exc}") from exc
    except tarfile.TarError as exc:
        raise DualCryptError(f"Archiv beschädigt: {exc}") from exc

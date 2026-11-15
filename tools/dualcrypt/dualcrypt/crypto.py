"""Schlüsselableitung und Container-Format (streamend, AES-256-GCM).

Dateiformat
-----------
Header (wird bei jedem Chunk als AAD authentifiziert):
    magic      8 B   b"DCRYPT1\\0"
    log2_n     1 B   scrypt-Kostenparameter N = 2**log2_n
    r          1 B   scrypt r
    p          1 B   scrypt p
    salt      16 B   zufällig
    nonce_pfx  8 B   zufällig
    chunk_size 4 B   Klartext-Bytes pro Chunk (big endian)

Danach beliebig viele Chunks:
    final      1 B   0x00 oder 0x01 (letzter Chunk)
    length     4 B   Länge des Ciphertexts inkl. 16 B GCM-Tag
    ciphertext length B

Nonce eines Chunks = nonce_pfx || Chunk-Zähler (4 B). AAD = Header || final.
Dadurch fallen Vertauschen, Löschen, Abschneiden und Manipulieren auf.
"""

from __future__ import annotations

import os
import struct
from typing import BinaryIO

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

MAGIC = b"DCRYPT1\0"
_HEADER = struct.Struct(">8sBBB16s8sI")
HEADER_SIZE = _HEADER.size
TAG_SIZE = 16
DEFAULT_CHUNK = 1024 * 1024
DEFAULT_LOG2_N = 17  # 128 MiB RAM, ~0.3 s
MAX_LOG2_N = 22  # Schutz vor bösartigen Headern (Speicher-DoS)
MAX_CHUNK = 64 * 1024 * 1024


class DualCryptError(Exception):
    """Fehler, der dem Benutzer direkt angezeigt werden kann."""


class WrongKeyOrCorrupt(DualCryptError):
    """Falsche Zahlenfolge/Wort oder beschädigte/manipulierte Datei."""


def derive_key(
    zahlen: str, wort: str, salt: bytes, log2_n: int, r: int, p: int
) -> bytes:
    """Beide Geheimnisse längenpräfixiert zusammenführen, dann scrypt."""
    if not zahlen or not wort:
        raise DualCryptError("Zahlenfolge und Wort dürfen nicht leer sein.")
    a, b = zahlen.encode(), wort.encode()
    material = struct.pack(">I", len(a)) + a + struct.pack(">I", len(b)) + b
    kdf = Scrypt(salt=salt, length=32, n=2**log2_n, r=r, p=p)
    return kdf.derive(material)


def _nonce(prefix: bytes, counter: int) -> bytes:
    return prefix + struct.pack(">I", counter)


class EncryptWriter:
    """Datei-ähnliches Objekt: write() Klartext rein, verschlüsselter Strom raus."""

    def __init__(
        self,
        out: BinaryIO,
        zahlen: str,
        wort: str,
        *,
        log2_n: int = DEFAULT_LOG2_N,
        chunk_size: int = DEFAULT_CHUNK,
    ) -> None:
        salt, self._prefix = os.urandom(16), os.urandom(8)
        self._header = _HEADER.pack(MAGIC, log2_n, 8, 1, salt, self._prefix, chunk_size)
        self._aes = AESGCM(derive_key(zahlen, wort, salt, log2_n, 8, 1))
        self._out, self._chunk = out, chunk_size
        self._buf, self._counter, self._closed = bytearray(), 0, False
        out.write(self._header)

    def _emit(self, data: bytes, final: bool) -> None:
        flag = b"\x01" if final else b"\x00"
        ct = self._aes.encrypt(_nonce(self._prefix, self._counter), data, self._header + flag)
        self._out.write(flag + struct.pack(">I", len(ct)) + ct)
        self._counter += 1

    def write(self, data: bytes) -> int:
        self._buf += data
        # Immer ein Rest zurückhalten, damit der letzte Chunk als "final" markiert werden kann.
        while len(self._buf) > self._chunk:
            self._emit(bytes(self._buf[: self._chunk]), False)
            del self._buf[: self._chunk]
        return len(data)

    def close(self) -> None:
        if not self._closed:
            self._emit(bytes(self._buf), True)
            self._buf.clear()
            self._closed = True

    def __enter__(self) -> "EncryptWriter":
        return self

    def __exit__(self, exc_type, *_) -> None:
        if exc_type is None:
            self.close()


class DecryptReader:
    """Datei-ähnliches Objekt (read), liefert Klartext und prüft jeden Chunk."""

    def __init__(self, src: BinaryIO, zahlen: str, wort: str) -> None:
        raw = src.read(HEADER_SIZE)
        if len(raw) < HEADER_SIZE:
            raise DualCryptError("Datei zu kurz – keine dualcrypt-Datei.")
        magic, log2_n, r, p, salt, self._prefix, self._chunk = _HEADER.unpack(raw)
        if magic != MAGIC:
            raise DualCryptError("Keine dualcrypt-Datei (falsche Kennung).")
        if not (10 <= log2_n <= MAX_LOG2_N and 1 <= r <= 32 and 1 <= p <= 16):
            raise DualCryptError("Ungültige KDF-Parameter im Header.")
        if not (1 <= self._chunk <= MAX_CHUNK):
            raise DualCryptError("Ungültige Chunk-Größe im Header.")
        self._header, self._src = raw, src
        self._aes = AESGCM(derive_key(zahlen, wort, salt, log2_n, r, p))
        self._buf, self._counter, self._done = b"", 0, False

    def _next_chunk(self) -> None:
        head = self._src.read(5)
        if len(head) < 5:
            raise WrongKeyOrCorrupt("Datei abgeschnitten (kein Abschluss-Chunk).")
        flag, length = head[:1], struct.unpack(">I", head[1:])[0]
        if flag not in (b"\x00", b"\x01") or not (TAG_SIZE <= length <= self._chunk + TAG_SIZE):
            raise WrongKeyOrCorrupt("Beschädigte Chunk-Daten.")
        ct = self._src.read(length)
        if len(ct) < length:
            raise WrongKeyOrCorrupt("Datei abgeschnitten.")
        try:
            pt = self._aes.decrypt(_nonce(self._prefix, self._counter), ct, self._header + flag)
        except InvalidTag:
            raise WrongKeyOrCorrupt(
                "Entschlüsselung fehlgeschlagen: falsche Zahlenfolge/falsches Wort "
                "oder Datei beschädigt."
            ) from None
        self._counter += 1
        self._buf += pt
        if flag == b"\x01":
            if self._src.read(1):
                raise WrongKeyOrCorrupt("Unerwartete Daten nach dem Abschluss-Chunk.")
            self._done = True

    def read(self, n: int = -1) -> bytes:
        while not self._done and (n < 0 or len(self._buf) < n):
            self._next_chunk()
        if n < 0:
            n = len(self._buf)
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def drain(self) -> None:
        """Alles bis zum Ende lesen, damit die Vollständigkeit geprüft wird."""
        while not self._done:
            self._next_chunk()

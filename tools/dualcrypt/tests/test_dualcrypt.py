import io
import os
import tarfile
from pathlib import Path

import pytest

from dualcrypt import cli
from dualcrypt.core import decrypt_file, encrypt_path
from dualcrypt.crypto import (
    DecryptReader,
    DualCryptError,
    EncryptWriter,
    WrongKeyOrCorrupt,
)

FAST = 10  # kleines scrypt-N für schnelle Tests
Z, W = "4711081512", "Correct Horse Battery"


def _roundtrip(data: bytes, chunk: int) -> bytes:
    buf = io.BytesIO()
    with EncryptWriter(buf, Z, W, log2_n=FAST, chunk_size=chunk) as w:
        w.write(data)
    buf.seek(0)
    return DecryptReader(buf, Z, W).read()


@pytest.mark.parametrize("size", [0, 1, 15, 16, 17, 100])
def test_stream_roundtrip_chunk_boundaries(size):
    data = os.urandom(size)
    assert _roundtrip(data, 16) == data


def _enc(data=b"hallo welt") -> bytes:
    buf = io.BytesIO()
    with EncryptWriter(buf, Z, W, log2_n=FAST, chunk_size=16) as w:
        w.write(data)
    return buf.getvalue()


@pytest.mark.parametrize("z,w", [("1", W), (Z, "falsch"), ("", W)])
def test_wrong_key_rejected(z, w):
    blob = _enc()
    with pytest.raises(DualCryptError):
        DecryptReader(io.BytesIO(blob), z, w).read()


def test_both_secrets_needed_and_order_unambiguous():
    blob = _enc()
    # "12"+"3abc" darf nicht wie "1"+"23abc" wirken
    with pytest.raises(WrongKeyOrCorrupt):
        DecryptReader(io.BytesIO(_enc()), "12", "3" + W).read()
    assert DecryptReader(io.BytesIO(blob), Z, W).read() == b"hallo welt"


def test_tamper_detected():
    blob = bytearray(_enc(os.urandom(60)))
    blob[-5] ^= 1
    with pytest.raises(WrongKeyOrCorrupt):
        DecryptReader(io.BytesIO(bytes(blob)), Z, W).read()


def test_truncation_detected():
    data = os.urandom(60)  # mehrere 16-Byte-Chunks
    blob = _enc(data)
    # letzten Chunk entfernen -> kein Abschluss-Chunk
    for cut in (len(blob) - 1, len(blob) - 20, 47):
        with pytest.raises(WrongKeyOrCorrupt):
            DecryptReader(io.BytesIO(blob[:cut]), Z, W).read()


def test_not_our_file():
    with pytest.raises(DualCryptError):
        DecryptReader(io.BytesIO(b"x" * 100), Z, W)


def test_header_tamper_detected():
    blob = bytearray(_enc())
    blob[12] ^= 1  # salt -> falscher Schlüssel
    with pytest.raises(WrongKeyOrCorrupt):
        DecryptReader(io.BytesIO(bytes(blob)), Z, W).read()


def _make_tree(root: Path) -> None:
    (root / "sub" / "tief").mkdir(parents=True)
    (root / "a.txt").write_text("Hallo ä ö ü")
    (root / "sub" / "b.bin").write_bytes(os.urandom(3_000_000))
    (root / "sub" / "tief" / "c.txt").write_text("c")
    (root / "leer").mkdir()


def _same(a: Path, b: Path) -> bool:
    fa = sorted(p.relative_to(a) for p in a.rglob("*"))
    fb = sorted(p.relative_to(b) for p in b.rglob("*"))
    return fa == fb and all(
        (a / p).read_bytes() == (b / p).read_bytes() for p in fa if (a / p).is_file()
    )


def test_folder_roundtrip(tmp_path):
    src = tmp_path / "projekt"
    _make_tree(src)
    enc = tmp_path / "projekt.dcr"
    encrypt_path(src, enc, Z, W, log2_n=FAST)
    out = tmp_path / "out"
    decrypt_file(enc, out, Z, W)
    assert _same(src, out / "projekt")


def test_single_file_roundtrip(tmp_path):
    f = tmp_path / "geheim.txt"
    f.write_text("top secret")
    encrypt_path(f, tmp_path / "g.dcr", Z, W, log2_n=FAST)
    decrypt_file(tmp_path / "g.dcr", tmp_path / "o", Z, W)
    assert (tmp_path / "o" / "geheim.txt").read_text() == "top secret"


def test_wrong_key_leaves_nothing_behind(tmp_path):
    src = tmp_path / "p"
    _make_tree(src)
    encrypt_path(src, tmp_path / "p.dcr", Z, W, log2_n=FAST)
    with pytest.raises(WrongKeyOrCorrupt):
        decrypt_file(tmp_path / "p.dcr", tmp_path / "out", Z, "falsch")
    assert not (tmp_path / "out").exists()
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".dcr-")]


def test_no_overwrite_without_force(tmp_path):
    f = tmp_path / "x.txt"
    f.write_text("1")
    encrypt_path(f, tmp_path / "x.dcr", Z, W, log2_n=FAST)
    with pytest.raises(DualCryptError):
        encrypt_path(f, tmp_path / "x.dcr", Z, W, log2_n=FAST)
    encrypt_path(f, tmp_path / "x.dcr", Z, W, force=True, log2_n=FAST)


def test_output_inside_source_rejected(tmp_path):
    src = tmp_path / "p"
    src.mkdir()
    with pytest.raises(DualCryptError):
        encrypt_path(src, src / "p.dcr", Z, W, log2_n=FAST)


def test_malicious_archive_blocked(tmp_path):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w|") as t:
        info = tarfile.TarInfo("../evil.txt")
        info.size = 4
        t.addfile(info, io.BytesIO(b"evil"))
    enc = tmp_path / "evil.dcr"
    with enc.open("wb") as fh, EncryptWriter(fh, Z, W, log2_n=FAST) as w:
        w.write(raw.getvalue())
    with pytest.raises(DualCryptError):
        decrypt_file(enc, tmp_path / "out", Z, W)
    assert not (tmp_path / "evil.txt").exists()


def test_cli_roundtrip(tmp_path, monkeypatch, capsys):
    import dualcrypt.core as core
    orig = core.encrypt_path
    monkeypatch.setattr(cli, "encrypt_path", lambda *a, **k: orig(*a, log2_n=FAST, **k))
    src = tmp_path / "d"
    src.mkdir()
    (src / "f.txt").write_text("hi")
    answers = iter([Z, W, Z, W])
    monkeypatch.setattr(cli.getpass, "getpass", lambda _p="": next(answers))
    assert cli.main(["encrypt", str(src)]) == 0
    answers = iter([Z, W])
    assert cli.main(["decrypt", str(tmp_path / "d.dcr")]) == 0
    assert (tmp_path / "d_entschluesselt" / "d" / "f.txt").read_text() == "hi"
    answers = iter(["999", "nope"])
    assert cli.main(["decrypt", str(tmp_path / "d.dcr"), "-o", str(tmp_path / "z")]) == 1


def test_cli_rejects_non_digits(monkeypatch):
    monkeypatch.setattr(cli.getpass, "getpass", lambda _p="": "abc")
    assert cli.main(["encrypt", "."]) == 1

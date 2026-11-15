# dualcrypt

Verschlüsselt Dateien und **ganze Ordner** mit zwei Geheimnissen: einer **Zahlenfolge** und einem **Geheimwort**. Ohne beides keine Entschlüsselung.

## Installation

```bash
cd tools/dualcrypt
pip install .          # Python >= 3.12
# oder ohne Installation:  python -m dualcrypt ...
```

## Benutzung

```bash
dualcrypt encrypt MeinOrdner            # -> MeinOrdner.dcr
dualcrypt decrypt MeinOrdner.dcr        # -> MeinOrdner_entschluesselt/MeinOrdner/...
dualcrypt decrypt MeinOrdner.dcr -o Ziel
```

Optionen: `-o/--out` (Ziel), `-f/--force` (Vorhandenes überschreiben).
Die Geheimnisse werden **nur interaktiv** abgefragt (nicht als Argument, damit sie nicht in Shell-History oder Prozessliste landen).

## Sicherheit

- Schlüsselableitung: **scrypt** (N=2^17, 128 MiB) aus Zahlenfolge + Wort (längenpräfixiert, also eindeutig) + Zufalls-Salt.
- Verschlüsselung: **AES-256-GCM**, in 1-MiB-Chunks (große Ordner brauchen wenig RAM).
- Jeder Chunk ist authentifiziert und mit Header, Reihenfolge und „letzter Chunk"-Flag verknüpft: Manipulation, Vertauschen und Abschneiden werden erkannt.
- Entpacken ist abgesichert (kein `../`, keine absoluten Pfade, keine Links nach außen) und atomar: bei falschem Schlüssel bleibt nichts Halbfertiges zurück.
- **Nicht verborgen:** Dateinamen/Größen sind im Archiv verschlüsselt, die Gesamtgröße der `.dcr`-Datei aber sichtbar.
- Die Stärke hängt an deinen Geheimnissen: lange Zahlenfolge (≥ 8 Ziffern, besser 12+) und eine Passphrase. **Vergessen = Daten weg**, es gibt keine Wiederherstellung.
- Das Original wird nicht gelöscht; das machst du selbst nach einer Kontrolle.

## Tests

```bash
pip install pytest && pytest
```

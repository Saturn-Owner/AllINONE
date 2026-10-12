from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("allinone_updater", Path(__file__).resolve().parent.parent / "scripts/update-preview.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.installation = self.root / "installed"
        (self.installation / "app").mkdir(parents=True)
        (self.installation / "app/index.html").write_text("old app")
        (self.installation / "starten.py").write_text("old launcher")
        (self.installation / "aktualisieren.py").write_text("old updater")
        (self.installation / "my-backup.json").write_text("keep this user file")
        self.served = self.root / "served"
        (self.served / "downloads").mkdir(parents=True)
        handler = partial(QuietHandler, directory=str(self.served))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=lambda: self.server.serve_forever(poll_interval=0.01), daemon=True)
        self.thread.start()
        self.source = f"http://127.0.0.1:{self.server.server_port}"
        self.build = "a" * 64

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temporary.cleanup()

    def publish(self, extra=None):
        files = {
                "app/index.html": "new app",
                "app/assets/new.js": "new code",
                "starten.py": "new launcher",
                "aktualisieren.py": "new updater",
                "SO_STARTET_DIE_APP.txt": "instructions",
            }
        digest = hashlib.sha256(b"0.2.0\0")
        for name, value in sorted(files.items()):
            data = value.encode()
            digest.update(name.encode() + b"\0" + len(data).to_bytes(8, "big") + data)
        self.build = digest.hexdigest()
        files["version.json"] = json.dumps({"version": "0.2.0", "build": self.build})
        if extra and extra[0] == "AllINONE-Linux-Test/version.json":
            files["version.json"] = extra[1]
            extra = None
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            for name, text in files.items():
                archive.writestr("AllINONE-Linux-Test/" + name, text)
            if extra:
                archive.writestr(*extra)
        payload = content.getvalue()
        versions = self.served / "downloads/versions"
        versions.mkdir(exist_ok=True)
        (versions / f"{self.build}.zip").write_bytes(payload)
        (self.served / "downloads/linux-latest.json").write_text(json.dumps({
            "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload), "build": self.build,
            "archive": f"versions/{self.build}.zip",
        }))

    def assert_old_installation(self):
        self.assertEqual((self.installation / "app/index.html").read_text(), "old app")
        self.assertEqual((self.installation / "starten.py").read_text(), "old launcher")
        self.assertEqual((self.installation / "aktualisieren.py").read_text(), "old updater")
        self.assertEqual((self.installation / "my-backup.json").read_text(), "keep this user file")

    def test_update_replaces_app_and_keeps_user_files(self):
        self.publish()
        self.assertTrue(updater.update(self.installation, self.source))
        self.assertEqual((self.installation / "app/index.html").read_text(), "new app")
        self.assertEqual((self.installation / "starten.py").read_text(), "new launcher")
        self.assertEqual((self.installation / "aktualisieren.py").read_text(), "new updater")
        self.assertEqual((self.installation / "my-backup.json").read_text(), "keep this user file")

    def test_current_version_does_not_download_archive(self):
        self.publish()
        updater.update(self.installation, self.source)
        (self.served / f"downloads/versions/{self.build}.zip").unlink()
        self.assertFalse(updater.update(self.installation, self.source))

    def test_missing_or_modified_app_is_repaired_even_with_current_version(self):
        self.publish()
        updater.update(self.installation, self.source)
        (self.installation / "app/assets/new.js").unlink()
        self.assertTrue(updater.update(self.installation, self.source))
        self.assertEqual((self.installation / "app/assets/new.js").read_text(), "new code")
        (self.installation / "starten.py").write_text("damaged launcher")
        self.assertTrue(updater.update(self.installation, self.source))
        self.assertEqual((self.installation / "starten.py").read_text(), "new launcher")

    def test_malformed_archive_metadata_preserves_installation(self):
        self.publish(("AllINONE-Linux-Test/version.json", "[]"))
        with self.assertRaisesRegex(ValueError, "Version"):
            updater.update(self.installation, self.source)
        self.assert_old_installation()

    def test_tampered_download_preserves_installation(self):
        self.publish()
        path = self.served / f"downloads/versions/{self.build}.zip"
        path.write_bytes(path.read_bytes() + b"tampered")
        with self.assertRaisesRegex(ValueError, "Prüfsumme"):
            updater.update(self.installation, self.source)
        self.assert_old_installation()

    def test_path_escape_preserves_installation(self):
        self.publish(("AllINONE-Linux-Test/../../escape", "bad"))
        with self.assertRaisesRegex(ValueError, "Dateipfad"):
            updater.update(self.installation, self.source)
        self.assert_old_installation()
        self.assertFalse((self.root / "escape").exists())

    def test_symlink_in_archive_is_rejected(self):
        entry = zipfile.ZipInfo("AllINONE-Linux-Test/app/link")
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.publish((entry, "../../escape"))
        with self.assertRaisesRegex(ValueError, "Dateipfad"):
            updater.update(self.installation, self.source)
        self.assert_old_installation()

    def test_file_replacement_failure_rolls_back(self):
        self.publish()
        original = updater.os.replace
        failed = False

        def fail_once(source, target):
            nonlocal failed
            if Path(target) == self.installation / "aktualisieren.py" and not failed:
                failed = True
                raise OSError("simulated write failure")
            return original(source, target)

        with patch.object(updater.os, "replace", side_effect=fail_once):
            with self.assertRaisesRegex(OSError, "simulated"):
                updater.update(self.installation, self.source)
        self.assert_old_installation()
        self.assertFalse((self.installation / "version.json").exists())

    def test_recovery_failure_preserves_backup_files(self):
        self.publish()
        original = updater.os.replace

        def fail_on_updater(source, target):
            if Path(target) == self.installation / "aktualisieren.py":
                raise OSError("simulated persistent write failure")
            return original(source, target)

        with patch.object(updater.os, "replace", side_effect=fail_on_updater):
            with self.assertRaises(updater.RecoveryError):
                updater.update(self.installation, self.source)
        stages = list(self.installation.glob(".allinone-update-*"))
        self.assertEqual(len(stages), 1)
        self.assertEqual((stages[0] / "previous/aktualisieren.py").read_text(), "old updater")
        self.assertEqual((self.installation / "app/index.html").read_text(), "old app")


if __name__ == "__main__":
    unittest.main()

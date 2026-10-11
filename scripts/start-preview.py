"""Start the packaged AllINONE preview on this computer."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser


class PreviewHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    app_directory = Path(__file__).resolve().parent / "app"
    if not (app_directory / "index.html").is_file():
        raise SystemExit("Die App-Dateien fehlen. Bitte das gesamte ZIP entpacken.")
    url = "http://localhost:4175/"
    handler = partial(PreviewHandler, directory=str(app_directory))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", 4175), handler)
    except OSError:
        raise SystemExit("Port 4175 ist bereits belegt. Beende die andere Vorschau und versuche es erneut.")
    print(f"AllINONE läuft: {url}", flush=True)
    print("Lass dieses Terminal offen. Mit Strg+C beendest du die Vorschau.", flush=True)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

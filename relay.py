"""Free local helper for the NBA Live Value Board.

Only needed if the page says your browser can't reach the live feeds directly.
Run:  python relay.py   (Python 3, no installs). Keep the window open.

It forwards two read-only feeds to your browser:
  http://127.0.0.1:8787/nba/...  -> https://cdn.nba.com/...
  http://127.0.0.1:8787/pm/...   -> https://gamma-api.polymarket.com/...
  http://127.0.0.1:8787/espn/... -> https://site.api.espn.com/...
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

UPSTREAMS = {
    "/nba/": "https://cdn.nba.com/",
    "/pm/": "https://gamma-api.polymarket.com/",
    "/espn/": "https://site.api.espn.com/",
}
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nba.com/",
}


class Relay(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        for prefix, base in UPSTREAMS.items():
            if self.path.startswith(prefix):
                url = base + self.path[len(prefix):]
                break
        else:
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        try:
            with urlopen(Request(url, headers=HEADERS), timeout=10) as r:
                body = r.read()
                code = r.status
        except HTTPError as e:
            body, code = e.read(), e.code
        except URLError as e:
            body, code = str(e.reason).encode(), 502
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass  # keep the window quiet


SELF_URL = "https://raw.githubusercontent.com/abc123286/nba-live-board/main/relay.py"


def self_update():
    """Fetch the latest helper from GitHub; if it changed, save it and restart."""
    import os, sys
    try:
        with urlopen(Request(SELF_URL, headers={"User-Agent": "nba-live-board"}), timeout=8) as r:
            new = r.read()
        here = os.path.abspath(__file__)
        with open(here, "rb") as f:
            old = f.read()
        if new.strip() and new != old and b"def self_update" in new:
            with open(here, "wb") as f:
                f.write(new)
            print("Helper updated to the latest version. Restarting...")
            os.execv(sys.executable, [sys.executable, here])
    except Exception:
        pass  # offline or GitHub unreachable: keep running the current version


if __name__ == "__main__":
    self_update()
    print("NBA relay running on http://127.0.0.1:8787  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", 8787), Relay).serve_forever()

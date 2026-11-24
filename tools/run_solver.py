#!/usr/bin/env python3
"""Runs the in-browser solver against a local static server and prints results."""
import json
import sys
import threading
import functools
import http.server
import socketserver
import pathlib
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8731


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    handler = functools.partial(Handler, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def main():
    levels = sys.argv[1:] or ["0"]
    samples = 9000
    serve()
    from playwright.sync_api import sync_playwright

    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.on("console", lambda m: print("[console]", m.text, file=sys.stderr))
        pg.on("pageerror", lambda e: print("[pageerror]", e, file=sys.stderr))
        pg.goto(f"http://127.0.0.1:{PORT}/tools/solver.html")
        pg.wait_for_function("window.READY === true", timeout=20000)
        for lv in levels:
            t0 = time.time()
            res = pg.evaluate(f"window.solveLevel({int(lv)}, {{budget: 6000, branch: 4}})")
            out[lv] = res
            dt = time.time() - t0
            if res.get("solution"):
                print(f"#{int(lv)+1} {res['name']}: echoes={res.get('echoes', 0)} frames={res.get('frames')} ({dt:.1f}s)")
                print("  solution:", json.dumps(res["solution"]))
            else:
                print(f"#{int(lv)+1} {res['name']}: FAILED ({dt:.1f}s)")
        b.close()
    pathlib.Path(ROOT / "tools" / "solutions.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Solves the level table with the in-browser beam search and caches results.

Usage: python3 tools/solve_all.py [level ...]
Writes tools/solutions.json (merged) and prints a summary table.
"""
import functools
import http.server
import json
import pathlib
import socketserver
import sys
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8765
CACHE = ROOT / "tools" / "solutions.json"


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

ARGS = [
    {"width": 900, "depth": 90, "chunk": 3, "branch": 6},
    {"width": 1500, "depth": 100, "chunk": 3, "branch": 8},
    {"width": 700, "depth": 120, "chunk": 4, "branch": 6},
]

def main():
    wanted = [int(x) for x in sys.argv[1:]] or list(range(8))
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        pg.on("pageerror", lambda e: print("[err]", e, file=sys.stderr))
        pg.goto(f"http://127.0.0.1:{PORT}/tools/solver.html")
        pg.wait_for_function("window.READY === true", timeout=20000)
        for lv in [w for w in wanted if w < 6]:
            if str(lv) in cache and cache[str(lv)].get("verified"):
                print(f"#{lv+1} cached: {cache[str(lv)]['name']} echoes={cache[str(lv)]['echoes']}")
                continue
            got = None
            for i, a in enumerate(ARGS):
                t = time.time()
                r = pg.evaluate(f"window.solveLevel({lv}, {json.dumps(a)})")
                dt = time.time() - t
                if r.get("solution") and r.get("verified"):
                    got = r
                    print(f"#{lv+1} {r['name']}: echoes={r['echoes']} verified (cfg {i}, {dt:.0f}s)")
                    break
                print(f"  .. level {lv+1} cfg {i} failed ({dt:.0f}s)")
            if got:
                cache[str(lv)] = {"name": got["name"], "echoes": got["echoes"], "solution": got["solution"]}
                CACHE.write_text(json.dumps(cache, indent=1))
            else:
                print(f"#{lv+1} FAILED")
        b.close()
    missing = [i for i in range(8) if str(i) not in cache or not cache[str(i)].get("solution")]
    print("missing:", missing)


if __name__ == "__main__":
    main()

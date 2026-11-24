#!/usr/bin/env python3
"""Smoke test: boots the build in Chromium, plays level 1, saves screenshots."""
import functools
import http.server
import json
import pathlib
import socketserver
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8761


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(H, directory=str(ROOT / "build")))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_function("window.__afterimage !== undefined", timeout=15000)
    pg.wait_for_timeout(500)
    pg.screenshot(path=str(ROOT / "shots/01-title.png"))

    pg.evaluate("window.__afterimage.loadLevel(0)")
    pg.wait_for_timeout(200)
    pg.screenshot(path=str(ROOT / "shots/02-level1.png"))

    sol = json.loads((ROOT / "tools/solutions.json").read_text())
    attempts = sol["0"]["solution"]
    pg.evaluate("(a) => window.__afterimage.setAuto(a)", attempts)
    st = None
    for i in range(60):
        st = pg.evaluate("window.__afterimage.stepFrames(10)")
        if st["won"]:
            break
    pg.wait_for_timeout(150)
    pg.screenshot(path=str(ROOT / "shots/03-level1-play.png"))
    print("state:", st)
    print("errors:", errors[:10])
    b.close()

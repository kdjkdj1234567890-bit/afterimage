#!/usr/bin/env python3
"""End-to-end test: plays every room in the shipped build through the real
input path and asserts a win. Also checks the console stays clean."""
import functools
import http.server
import json
import pathlib
import socketserver
import sys
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8775


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(H, directory=str(ROOT / "build")))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("console:" + m.text) if m.type == "error" else None)
    pg.goto(f"http://127.0.0.1:{PORT}/index.html")
    pg.wait_for_function("window.__afterimage !== undefined")
    pg.evaluate("window.__afterimage.setLoop(false)")

    fails = 0
    for lv in range(6):
        info = pg.evaluate(f"window.__afterimage.loadLevel({lv})")
        pg.evaluate(f"window.__afterimage.setAuto(window.__SOLUTIONS[{lv}].attempts)")
        st = None
        for _ in range(120):
            st = pg.evaluate("window.__afterimage.stepFrames(20)")
            if st["won"]:
                break
        ok = bool(st and st["won"])
        fails += 0 if ok else 1
        print(f"{'PASS' if ok else 'FAIL'}  room {lv+1}: {info['name']:<12} par={info['par']} echoes={len(st['echoes'])} t={st['time']:.1f}s")

    print("console/page errors:", errors[:5])
    print("RESULT:", "ALL PASS" if fails == 0 and not errors else f"{fails} fail")
    b.close()
    sys.exit(0 if fails == 0 and not errors else 1)

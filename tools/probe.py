#!/usr/bin/env python3
"""Ad-hoc probe: steps the real engine in Chromium and prints state."""
import functools
import http.server
import json
import pathlib
import socketserver
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8733


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(H, directory=str(ROOT)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

JS = """
async () => {
  const eng = await import('/build/js/engine.js');
  const { LEVELS } = await import('/build/js/levels.js');
  const w = new eng.World(LEVELS[0]);
  const out = [];
  const keys = (k, n) => { for (let i=0;i<n;i++){ w.step({left:k.includes('L'),right:k.includes('R'),jump:k.includes('J'),jumpPressed:k.includes('J') && i===0}); out.push([Math.round(w.player.x),Math.round(w.player.y),w.player.onGround?1:0,w.state]); } };
  keys('R', 40);
  keys('RJ', 20);
  keys('R', 60);
  return {len: out.length, sample: out.filter((_,i)=>i%10===0), state: w.state, echoes: w.echoes.length};
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.on("pageerror", lambda e: print("[pageerror]", e))
    pg.goto(f"http://127.0.0.1:{PORT}/tools/solver.html")
    pg.wait_for_function("window.READY === true")
    print(json.dumps(pg.evaluate(JS), indent=1))
    b.close()

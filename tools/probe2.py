#!/usr/bin/env python3
"""Probe: try a hand-written two-attempt solution and trace it."""
import functools
import http.server
import json
import pathlib
import socketserver
import threading

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8734


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
  const def = LEVELS[0];
  const att = [
    [['R',42],['RJ',18],['R',20]],
    [['R',44],['N',24],['RJ',20],['R',40]]
  ];
  const res = eng.simulate(def, att, {maxFrames: 60*40});
  const w = res.world;
  const lvl = new eng.World(def).level;
  const trace = [];
  const w2 = new eng.World(def);
  let prev=false;
  const steps=[];
  for (let a=0;a<att.length;a++){
    if(a>0){ if(w2.state==='play') w2.commitEcho(); w2.startAttempt(); }
    for(const [k,d] of att[a]) for(let i=0;i<d;i++){
var j=k.includes('J');
      w2.step({left:k.includes('L'),right:k.includes('R'),jump:j,jumpPressed:j&&!prev}); prev=j;
      steps.push([steps.length,w2.state,Math.round(w2.player.x),Math.round(w2.player.y),w2.player.onGround?1:0,w2.echoes.length]);
      if(w2.state==='dead')break;
    }
  }
  return {won: res.won, frames: res.frames, goal: lvl.goal, spawn: lvl.spawn,
          echoes: w.echoes.map(e=>({x:Math.round(e.x),y:Math.round(e.y),n:e.frames.length})),
          tail: steps.filter((s,i)=>i%6===0).slice(0,90)};
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    pg.on("pageerror", lambda e: print("[pageerror]", e))
    pg.goto(f"http://127.0.0.1:{PORT}/tools/solver.html")
    pg.wait_for_function("window.READY === true")
    r = pg.evaluate(JS)
    print("won", r["won"], "frames", r["frames"])
    print("goal", r["goal"], "spawn", r["spawn"])
    print("echoes", r["echoes"])
    for s in r["tail"]:
        print(s)
    b.close()

#!/usr/bin/env python3
"""Records the AFTERIMAGE demo: plays the verified solutions in real time while
capturing the canvas through CDP screencast, then muxes a synthesised score."""
import base64
import functools
import http.server
import math
import pathlib
import socketserver
import struct
import subprocess
import threading
import time
import wave

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "video"
FRAMES = OUT / "frames"
PORT = 8771
SR = 44100
FPS = 30


class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), functools.partial(H, directory=str(ROOT / "build")))
threading.Thread(target=httpd.serve_forever, daemon=True).start()

from playwright.sync_api import sync_playwright

# (kind, level, seconds-to-hold-after-win)
PLAN = [
    ("title", 0, 3.0),
    ("level", 0, 1.7),
    ("level", 3, 1.7),
    ("level", 4, 1.7),
    ("level", 5, 1.7),
    ("finale", 0, 5.0),
]


def synth_score(path: pathlib.Path, seconds: float):
    """A slow A-minor arpeggio bed that matches the in-game score."""
    n = int(SR * seconds)
    t = np.arange(n) / SR
    buf = np.zeros(n, dtype=np.float32)

    def note(freq, start, dur, gain, kind="sine"):
        i0 = int(start * SR)
        i1 = min(n, i0 + int(dur * SR))
        if i0 >= n:
            return
        tt = np.arange(i1 - i0) / SR
        env = np.minimum(1, tt / 0.02) * np.exp(-tt * (3.2 if kind == "pluck" else 1.2))
        if kind == "pluck":
            w = np.sin(2 * np.pi * freq * tt) + 0.35 * np.sin(2 * np.pi * freq * 2 * tt)
        else:
            w = np.sin(2 * np.pi * freq * tt) + 0.5 * np.sin(2 * np.pi * freq * 1.005 * tt)
        buf[i0:i1] += (w * env * gain).astype(np.float32)

    base = 55.0
    scale = [0, 3, 5, 7, 10, 12, 15]
    bpm = 82
    eighth = 60 / bpm / 2
    steps = int(seconds / eighth)
    for s in range(steps):
        when = s * eighth
        if s % 8 == 0:
            root = scale[(s // 8) % len(scale)]
            note(base * 2 ** (root / 12) * 2, when, 3.4, 0.10)
            note(base * 2 ** ((root + 7) / 12) * 2, when, 3.6, 0.06)
        pattern = [0, 2, 4, 2, 5, 4, 2, 1]
        semi = scale[pattern[s % len(pattern)] % len(scale)] + (5 if (s // 8) % 2 else 0)
        note(base * 2 ** (semi / 12) * 8, when, 0.9, 0.05, "pluck")

    # gentle fade in/out
    fade = int(SR * 1.2)
    buf[:fade] *= np.linspace(0, 1, fade)
    buf[-fade:] *= np.linspace(1, 0, fade)
    peak = float(np.max(np.abs(buf))) or 1.0
    buf = np.clip(buf / peak * 0.62, -1, 1)
    stereo = np.stack([buf, np.roll(buf, 240)], axis=1)
    pcm = (stereo * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    FRAMES.mkdir(parents=True, exist_ok=True)
    for f in FRAMES.glob("*.jpg"):
        f.unlink()

    stamps = []
    counter = [0]

    shot = {"i": 0}

    def grab(page):
        path = FRAMES / f"f{shot['i']:05d}.jpg"
        page.screenshot(path=str(path), clip={"x": 0, "y": 0, "width": 1280, "height": 720}, type="jpeg", quality=88)
        shot["i"] += 1

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": 1280, "height": 720})
        page.goto(f"http://127.0.0.1:{PORT}/index.html")
        page.wait_for_function("window.__afterimage !== undefined")
        page.evaluate("window.__afterimage.cinema(true)")
        page.evaluate("window.__afterimage.unlockAll()")
        page.wait_for_timeout(600)
        page.evaluate("window.__afterimage.setLoop(false)")

        # 1. title / attract, two steps per output frame
        for _ in range(int(2.4 * FPS)):
            page.evaluate("window.__afterimage.stepFrames(0)")
            page.wait_for_timeout(4)
            grab(page)

        for lv in (0, 3, 4, 5):
            page.evaluate(f"window.__afterimage.loadLevel({lv})")
            page.evaluate(f"window.__afterimage.setAuto(window.__SOLUTIONS[{lv}].attempts)")
            idle = 0
            for _ in range(40 * FPS):
                st = page.evaluate("window.__afterimage.stepFrames(2)")
                grab(page)
                if st["won"] or st["state"] in ("won-wait", "complete"):
                    idle += 1
                    if idle > 40:
                        break
            page.wait_for_timeout(50)

        page.evaluate("window.__afterimage.showFinale()")
        for _ in range(int(3.6 * FPS)):
            page.evaluate("window.__afterimage.stepFrames(0)")
            page.wait_for_timeout(4)
            grab(page)

        b.close()

    print("frames:", shot["i"])

    durs = [1 / FPS] * shot["i"]
    total = sum(durs)
    concat = OUT / "frames.txt"
    lines = []
    for i, d in enumerate(durs):
        lines.append(f"file 'frames/f{i:05d}.jpg'")
        lines.append(f"duration {d:.4f}")
    lines.append(f"file 'frames/f{shot['i']-1:05d}.jpg'")
    concat.write_text("\n".join(lines) + "\n")

    score = OUT / "score.wav"
    synth_score(score, total + 0.5)

    mp4 = OUT / "afterimage-demo.mp4"
    cmd = [
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
        "-i", str(score), "-r", str(FPS), "-vsync", "cfr", "-pix_fmt", "yuv420p",
        "-c:v", "libx264", "-crf", "19", "-preset", "medium",
        "-c:a", "aac", "-b:a", "160k", "-shortest", str(mp4),
    ]
    exe = pathlib.Path("/workspace/.local/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2")
    if not exe.exists():
        exe = "ffmpeg"
    cmd[0] = str(exe)
    print("muxing…", total, "s")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("wrote", mp4, mp4.stat().st_size)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
frida_runner.py — Spawn Paltalk.exe via Frida, inject frida_capture_proto.js,
and capture the first 30 seconds of network traffic to capture_out.jsonl
"""
import frida
import sys
import time
import json
from pathlib import Path

PALTALK = r"C:\Users\rajesh\AppData\Local\Paltalk\Paltalk.exe"
SCRIPT_FILE = Path(__file__).parent / "frida_capture_proto.js"
OUTPUT_FILE = Path(__file__).parent / "capture_out.jsonl"
CAPTURE_SECS = 30

print(f"[*] Reading hook script: {SCRIPT_FILE}")
hook_src = SCRIPT_FILE.read_text(encoding="utf-8")

print(f"[*] Spawning: {PALTALK}")
try:
    device = frida.get_local_device()
    pid = device.spawn([PALTALK])
    print(f"[+] Spawned PID: {pid}")
except Exception as e:
    print(f"[-] Spawn failed: {e}")
    sys.exit(1)

session = device.attach(pid)
script = session.create_script(hook_src)

captured = []

def on_message(message, data):
    if message["type"] == "send":
        payload = message.get("payload", "")
        line = json.dumps(payload) if not isinstance(payload, str) else payload
        captured.append(line)
        print(f"  >> {line[:120]}")
    elif message["type"] == "error":
        print(f"  [ERR] {message.get('stack', message)}")

script.on("message", on_message)
script.load()

print(f"[+] Script injected. Resuming Paltalk...")
device.resume(pid)

print(f"[*] Capturing for {CAPTURE_SECS} seconds... (log in to Paltalk now)")
for i in range(CAPTURE_SECS):
    time.sleep(1)
    print(f"  [{i+1}/{CAPTURE_SECS}s] {len(captured)} packets captured", end="\r")

print(f"\n[+] Done. {len(captured)} packets captured.")

with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    for line in captured:
        f.write(line + "\n")

print(f"[+] Saved to: {OUTPUT_FILE}")
session.detach()

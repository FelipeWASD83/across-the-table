"""Demo without spending credit: the real server with data in %TEMP%\\across-the-table-demo and a fake Claude
that answers a random legal move (taken from the tool's enum) after a short pause.

    python tools\\demo.py [--porta 8085] [--pausa 1.2]
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(tempfile.gettempdir()) / "across-the-table-demo"
os.environ["ACROSS_THE_TABLE_DATA"] = str(DATA)
sys.path.insert(0, str(ROOT / "server"))

PAUSE = 1.2


class FakeClaude(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
        moves = body["tools"][0]["input_schema"]["properties"]["move"]["enum"]
        time.sleep(PAUSE)
        raw = json.dumps({"model": body.get("model"),
                          "content": [{"type": "thinking", "thinking": "", "signature": "demo"},
                                      {"type": "tool_use", "id": "toolu_demo", "name": "play_move",
                                       "input": {"move": random.choice(moves)}}],
                          "stop_reason": "tool_use", "usage": {"input_tokens": 900, "output_tokens": 300}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main() -> int:
    global PAUSE
    parser = argparse.ArgumentParser()
    parser.add_argument("--porta", default="8085")
    parser.add_argument("--pausa", type=float, default=PAUSE)
    args = parser.parse_args()
    PAUSE = max(0.0, args.pausa)
    fake = ThreadingHTTPServer(("127.0.0.1", 0), FakeClaude)
    threading.Thread(target=fake.serve_forever, daemon=True).start()
    from segredos import Segredos
    DATA.mkdir(parents=True, exist_ok=True)
    Segredos(DATA).guardar("claude", "sk-ant-demo-chave-falsa-0000")
    import server
    print(f"Demonstração: dados em {DATA}, Claude falso que joga lance aleatório (não gasta crédito).", flush=True)
    return server.main(["--porta", args.porta, "--url-claude", f"http://127.0.0.1:{fake.server_address[1]}/v1/messages"])


if __name__ == "__main__":
    sys.exit(main())

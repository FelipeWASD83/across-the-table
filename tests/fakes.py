"""A fake AI API (Claude and OpenAI) on a local port. Each test queues the answers it wants."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def claude_move(move: str):
    return 200, {"content": [{"type": "thinking", "thinking": "", "signature": "x"},
                             {"type": "tool_use", "id": "toolu_1", "name": "play_move", "input": {"move": move}}],
                 "stop_reason": "tool_use", "usage": {"input_tokens": 1000, "output_tokens": 200}}


def claude_text():
    return 200, {"content": [{"type": "text", "text": "Eu jogaria e4."}], "stop_reason": "end_turn",
                 "usage": {"input_tokens": 10, "output_tokens": 10}}


CREDIT = (400, {"type": "error", "error": {"type": "invalid_request_error", "message":
                "Your credit balance is too low to access the Anthropic API."}})


def openai_move(move: str):
    return 200, {"status": "completed", "output": [
        {"type": "function_call", "name": "play_move", "arguments": json.dumps({"move": move})}],
        "usage": {"input_tokens": 100, "output_tokens": 50}}


class FakeAPI:
    def __init__(self):
        self.answers: list[tuple[int, dict]] = []
        self.requests: list[dict] = []
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))
                fake.requests.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
                status, data = fake.answers.pop(0) if fake.answers else (500, {"error": {"message": "sem resposta"}})
                raw = json.dumps(data).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def claude_url(self):
        return f"http://127.0.0.1:{self.port}/v1/messages"

    @property
    def openai_url(self):
        return f"http://127.0.0.1:{self.port}/v1/responses"

    def close(self):
        self.server.shutdown()
        self.server.server_close()

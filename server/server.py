"""Do Outro Lado local server: the screen (app/) and the JSON API.

Only 127.0.0.1. Every /api request needs the `X-Mesa: 1` header (a page from another site cannot send it
without a CORS preflight, which this server never approves), the Host must be this server, and a request with
an Origin from somewhere else is refused. Keys never go back to the screen (only their last 4 characters).
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ai  # noqa: E402
import atualizador  # noqa: E402
import config  # noqa: E402
from provedor import Disjuntor  # noqa: E402
from segredos import Segredos  # noqa: E402

RESTART = 3
MAX_BODY = 512 * 1024
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
                ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json"}


class State:
    def __init__(self, url_claude: str, url_openai: str):
        self.secrets = Segredos(config.DATA)
        self.breaker = Disjuntor()
        self.url_claude = url_claude
        self.url_openai = url_openai
        self.server: ThreadingHTTPServer | None = None
        self.exit_code = 0

    def client(self, difficulty: str) -> ai.AIClient:
        cfg = config.load()
        return ai.AIClient(cfg["models"][difficulty], cfg["efforts"][difficulty], cfg["fallback"],
                           claude_key=self.secrets.obter("claude"), openai_key=self.secrets.obter("openai"),
                           url_claude=self.url_claude, url_openai=self.url_openai, breaker=self.breaker)


STATE: State | None = None


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "DoOutroLado"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        if os.environ.get("ACROSS_THE_TABLE_LOG"):
            super().log_message(fmt, *args)

    def _send(self, status: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        if status >= 400:
            # Read a waiting body before closing (a Windows socket closed with unread data resets the connection
            # before the client sees the answer), then close so an oversized body is never parsed as a request.
            if not getattr(self, "_body_read", True):
                length = int(self.headers.get("Content-Length") or 0)
                if 0 < length <= MAX_BODY:
                    self.rfile.read(length)
                self._body_read = True
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status: int = 200):
        self._send(status, json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8",
                   {"Cache-Control": "no-store"})

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").lower()
        port = self.server.server_address[1]
        return host in (f"127.0.0.1:{port}", f"localhost:{port}")

    def _origin_ok(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin.lower() == f"http://{(self.headers.get('Host') or '').lower()}"

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError("Pedido grande demais.", 413)
        self._body_read = True
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as e:
            raise ApiError("JSON inválido.") from e
        return data if isinstance(data, dict) else {}

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def _handle(self, method: str):
        self._body_read = False
        if not self._host_ok():
            return self._send(421, b"host recusado", "text/plain")
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path)
        try:
            if path.startswith("/api/"):
                if self.headers.get("X-Mesa") != "1" or not self._origin_ok():
                    return self._json({"erro": "Pedido recusado."}, 403)
                return self._api(method, path, urllib.parse.parse_qs(url.query))
            if method != "GET":
                return self._send(405, b"", "text/plain")
            return self._static(path)
        except ApiError as e:
            return self._json({"erro": str(e)}, e.status)
        except ai.AIError as e:
            return self._json({"erro": str(e), "semCredito": isinstance(e, ai.NoCreditError)}, 502)
        except atualizador.UpdateError as e:
            return self._json({"erro": str(e)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            return None
        except Exception as e:
            traceback.print_exc()
            return self._json({"erro": f"Erro no servidor: {e}"}, 500)

    def _static(self, path: str):
        if path in ("", "/"):
            path = "/index.html"
        target = (config.APP_DIR / path.lstrip("/")).resolve()
        if not target.is_relative_to(config.APP_DIR.resolve()) or not target.is_file():
            return self._send(404, b"nao achei", "text/plain")
        ctype = STATIC_TYPES.get(target.suffix.lower()) or mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self._send(200, target.read_bytes(), ctype, {"Cache-Control": "no-cache"})

    def _api(self, method: str, path: str, query: dict):
        parts = [p for p in path.split("/") if p][1:]   # without "api"
        route = (method, parts[0] if parts else "")

        if route == ("GET", "state"):
            return self._json(state_payload())

        if route == ("POST", "config"):
            config.save(self._body())
            return self._json(state_payload())

        if route == ("POST", "key"):
            body = self._body()
            name = body.get("name")
            if name not in ("claude", "openai", "github"):
                raise ApiError("Chave desconhecida.")
            STATE.secrets.guardar(name, str(body.get("value") or ""))
            return self._json(state_payload())

        if route == ("POST", "move"):
            body = self._body()
            difficulty = str(body.get("difficulty") or "")
            if difficulty not in config.DIFFICULTIES:
                raise ApiError("Dificuldade desconhecida.")
            result = STATE.client(difficulty).choose_move(body.get("game"), difficulty, body.get("position"),
                                                          body.get("moves"))
            return self._json(result)

        if parts[:1] == ["update"]:
            token = STATE.secrets.obter("github")
            action = parts[1] if len(parts) > 1 else ""
            if method == "GET" and not action:
                return self._json(atualizador.check(token, force=bool(query.get("force"))))
            if method == "POST" and action == "download":
                return self._json(atualizador.download_and_prepare(token))
            if method == "POST" and action == "restart":
                if not atualizador.pending():
                    raise ApiError("Não tem atualização baixada.")
                STATE.exit_code = RESTART
                threading.Thread(target=STATE.server.shutdown, daemon=True).start()
                return self._json({"ok": True})

        raise ApiError("Rota inexistente.", 404)


def state_payload() -> dict:
    s = STATE.secrets
    return {
        "version": config.VERSION,
        "config": config.load(),
        "models": [{"id": m, "name": n} for m, n in config.MODELS],
        "efforts": list(config.EFFORTS),
        "keys": {name: s.fim(name) for name in ("claude", "openai", "github")},
        "dev": atualizador.dev_copy(),
    }


def main(argv=None) -> int:
    global STATE
    parser = argparse.ArgumentParser(description="Servidor do Do Outro Lado")
    parser.add_argument("--porta", type=int, default=config.PORT)
    parser.add_argument("--url-claude", default=ai.URL_CLAUDE, help="só para teste")
    parser.add_argument("--url-openai", default=ai.URL_OPENAI, help="só para teste")
    args = parser.parse_args(argv)
    STATE = State(args.url_claude, args.url_openai)
    config.DATA.mkdir(parents=True, exist_ok=True)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.porta), Handler)
    except OSError as e:
        print(f"Não consegui abrir a porta {args.porta}: {e}", file=sys.stderr)
        return 1
    server.daemon_threads = True
    STATE.server = server
    print(f"Do Outro Lado {config.VERSION} em http://127.0.0.1:{args.porta}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return STATE.exit_code


if __name__ == "__main__":
    sys.exit(main())

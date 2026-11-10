"""The HTTP server: security checks, settings, keys and the move route, with a fake Claude."""

import http.client
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

TMP = tempfile.mkdtemp(prefix="across-the-table-test-")
os.environ["ACROSS_THE_TABLE_DATA"] = TMP

import config  # noqa: E402
import server  # noqa: E402
from tests.fakes import FakeAPI, claude_move  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = FakeAPI()
        server.STATE = server.State(cls.fake.claude_url, cls.fake.openai_url)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        server.STATE.server = cls.httpd
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.fake.close()
        shutil.rmtree(TMP, ignore_errors=True)

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"X-Mesa": "1", "Host": f"127.0.0.1:{self.port}"}
        h.update(headers or {})
        raw = json.dumps(body).encode() if body is not None else None
        if raw:
            h["Content-Type"] = "application/json"
        conn.request(method, path, body=raw, headers=h)
        res = conn.getresponse()
        data = res.read()
        conn.close()
        try:
            return res.status, json.loads(data)
        except ValueError:
            return res.status, data

    def test_page_and_static(self):
        status, body = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"Do Outro Lado", body)
        self.assertEqual(self.call("GET", "/js/games/chess.js")[0], 200)
        self.assertEqual(self.call("GET", "/../server/ai.py")[0], 404)

    def test_api_needs_header_and_same_origin(self):
        self.assertEqual(self.call("GET", "/api/state", headers={"X-Mesa": ""})[0], 403)
        self.assertEqual(self.call("GET", "/api/state", headers={"Origin": "https://example.com"})[0], 403)
        self.assertEqual(self.call("GET", "/api/state", headers={"Host": "evil.test"})[0], 421)

    def test_state_and_config(self):
        status, state = self.call("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(state["config"]["models"]["hard"], "claude-opus-5-5")
        status, state = self.call("POST", "/api/config", {"models": {"easy": "claude-sonnet-5-5"},
                                                          "efforts": {"hard": "xhigh", "medium": "absurd"}})
        self.assertEqual(state["config"]["models"]["easy"], "claude-sonnet-5-5")
        self.assertEqual(state["config"]["efforts"]["hard"], "xhigh")
        self.assertEqual(state["config"]["efforts"]["medium"], "medium")
        config.save({"models": dict(config.DEFAULT_MODELS), "efforts": dict(config.DEFAULT_EFFORTS)})

    def test_key_is_never_returned_whole(self):
        status, state = self.call("POST", "/api/key", {"name": "claude", "value": "sk-ant-segredo-1234"})
        self.assertEqual(status, 200)
        self.assertEqual(state["keys"]["claude"], "…1234")
        self.assertNotIn("segredo", json.dumps(state))
        self.assertEqual(self.call("POST", "/api/key", {"name": "outra", "value": "x"})[0], 400)

    def test_move_route(self):
        self.call("POST", "/api/key", {"name": "claude", "value": "sk-ant-segredo-1234"})
        self.fake.answers.append(claude_move("C2"))
        status, res = self.call("POST", "/api/move", {"game": "tictactoe", "difficulty": "easy",
                                                     "position": "board", "moves": ["A1", "C2"]})
        self.assertEqual(status, 200)
        self.assertEqual(res["move"], "C2")
        self.assertEqual(res["model"], "claude-haiku-5-5")
        sent = self.fake.requests[-1]
        self.assertEqual(sent["headers"].get("x-api-key"), "sk-ant-segredo-1234")

    def test_move_errors_reach_the_screen(self):
        self.call("POST", "/api/key", {"name": "claude", "value": "sk-ant-segredo-1234"})
        self.fake.answers.append((401, {"error": {"message": "invalid"}}))
        status, res = self.call("POST", "/api/move", {"game": "chess", "difficulty": "medium",
                                                     "position": "p", "moves": ["e4", "d4"]})
        self.assertEqual(status, 502)
        self.assertIn("recusou a chave", res["erro"])
        self.assertEqual(self.call("POST", "/api/move", {"game": "chess", "difficulty": "x",
                                                         "position": "p", "moves": ["e4"]})[0], 400)


if __name__ == "__main__":
    unittest.main()

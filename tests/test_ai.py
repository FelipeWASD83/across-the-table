"""ai.py against a fake API: request shape, legal-move guarantee, nudge, random fallback and credit swap."""

import unittest

import ai
from tests.fakes import CREDIT, FakeAPI, claude_move, claude_text, openai_move

POSITION = "You play Black; it is your move.\n\nFEN: x"
MOVES = ["e5", "Nf6", "d5"]


class AITest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeAPI()

    def tearDown(self):
        self.fake.close()

    def client(self, model="claude-sonnet-5-5", effort="medium", **kw):
        kw.setdefault("claude_key", "sk-ant-test")
        return ai.AIClient(model, effort, url_claude=self.fake.claude_url, url_openai=self.fake.openai_url, **kw)

    def test_request_shape(self):
        self.fake.answers.append(claude_move("Nf6"))
        result = self.client().choose_move("chess", "hard", POSITION, MOVES)
        self.assertEqual(result["move"], "Nf6")
        self.assertFalse(result["random"])
        self.assertGreater(result["cost"], 0)
        req = self.fake.requests[0]
        body = req["body"]
        tool = body["tools"][0]
        self.assertEqual(tool["name"], "play_move")
        self.assertTrue(tool["strict"])
        self.assertEqual(tool["input_schema"]["properties"]["move"]["enum"], MOVES)
        self.assertFalse(tool["input_schema"]["additionalProperties"])
        self.assertEqual(body["tool_choice"], {"type": "auto"})
        self.assertEqual(body["output_config"]["effort"], "medium")
        self.assertNotIn("temperature", body)
        self.assertEqual(body["fallbacks"], "default")
        self.assertEqual(req["headers"].get("anthropic-beta"), ai.FALLBACK_BETA)
        self.assertIn("Play as strongly as you can", body["system"][0]["text"])
        self.assertNotIn("bad moves on purpose", body["system"][0]["text"])
        self.assertIn("- Nf6", body["messages"][0]["content"][0]["text"])

    def test_haiku_has_no_fallback_param(self):
        self.fake.answers.append(claude_move("e5"))
        self.client("claude-haiku-5-5", "low").choose_move("chess", "hard", POSITION, MOVES)
        body = self.fake.requests[0]["body"]
        self.assertNotIn("fallbacks", body)
        self.assertNotIn("anthropic-beta", self.fake.requests[0]["headers"])

    def test_levels_only_change_the_prompt(self):
        prompts = {}
        for level in ("easy", "medium", "hard"):
            self.fake.answers.append(claude_move("e5"))
            self.client().choose_move("chess", level, POSITION, MOVES)
            body = self.fake.requests[-1]["body"]
            self.assertEqual(body["model"], "claude-sonnet-5-5")
            self.assertEqual(body["output_config"]["effort"], "medium")
            prompts[level] = body["system"][0]["text"]
        self.assertEqual(len(set(prompts.values())), 3)
        self.assertIn("beginner who only knows how the pieces move", prompts["easy"])
        self.assertIn("bad moves on purpose", prompts["easy"])
        self.assertIn("do not throw the game", prompts["easy"])
        self.assertIn("average casual player", prompts["medium"])

    def test_beginner_text_is_game_specific(self):
        self.assertIn("young child", ai.system_prompt("tictactoe", "easy"))
        self.assertIn("corners and edges", ai.system_prompt("reversi", "easy"))
        self.assertNotIn("young child", ai.system_prompt("chess", "easy"))

    def test_single_move_skips_the_api(self):
        result = self.client().choose_move("tictactoe", "medium", "board", ["B2"])
        self.assertEqual(result["move"], "B2")
        self.assertTrue(result["forced"])
        self.assertEqual(self.fake.requests, [])

    def test_text_answer_gets_one_nudge(self):
        self.fake.answers += [claude_text(), claude_move("d5")]
        result = self.client().choose_move("chess", "medium", POSITION, MOVES)
        self.assertEqual(result["move"], "d5")
        second = self.fake.requests[1]["body"]["messages"]
        self.assertEqual(second[1]["role"], "assistant")
        self.assertEqual(second[2]["role"], "user")

    def test_illegal_move_twice_becomes_random_legal_move(self):
        self.fake.answers += [claude_move("Ke2"), claude_move("Qh4")]
        result = self.client().choose_move("chess", "medium", POSITION, MOVES)
        self.assertIn(result["move"], MOVES)
        self.assertTrue(result["random"])
        nudge = self.fake.requests[1]["body"]["messages"][2]["content"]
        self.assertEqual(nudge[0]["type"], "tool_result")
        self.assertTrue(nudge[0]["is_error"])

    def test_no_credit_swaps_to_openai(self):
        self.fake.answers += [CREDIT, openai_move("e5")]
        client = self.client(openai_key="sk-openai")
        result = client.choose_move("chess", "medium", POSITION, MOVES)
        self.assertEqual(result["move"], "e5")
        self.assertTrue(result["replaced"])
        self.assertTrue(self.fake.requests[1]["path"].endswith("/responses"))
        body = self.fake.requests[1]["body"]
        self.assertEqual(body["tools"][0]["parameters"]["properties"]["move"]["enum"], MOVES)
        # the empty side rests: the next call goes straight to OpenAI
        self.fake.answers.append(openai_move("d5"))
        client.choose_move("chess", "medium", POSITION, MOVES)
        self.assertTrue(self.fake.requests[2]["path"].endswith("/responses"))

    def test_no_credit_without_spare_key(self):
        self.fake.answers.append(CREDIT)
        with self.assertRaises(ai.NoCreditError):
            self.client().choose_move("chess", "medium", POSITION, MOVES)

    def test_bad_key_message(self):
        self.fake.answers.append((401, {"error": {"message": "invalid x-api-key"}}))
        with self.assertRaisesRegex(ai.AIError, "recusou a chave"):
            self.client().choose_move("chess", "medium", POSITION, MOVES)

    def test_refusal(self):
        self.fake.answers.append((200, {"content": [], "stop_reason": "refusal",
                                        "stop_details": {"category": "cyber", "explanation": "nope"}}))
        with self.assertRaisesRegex(ai.AIError, "recusou"):
            self.client().choose_move("chess", "medium", POSITION, MOVES)

    def test_request_validation(self):
        c = self.client()
        with self.assertRaises(ai.AIError):
            c.choose_move("poker", "medium", POSITION, MOVES)
        with self.assertRaises(ai.AIError):
            c.choose_move("chess", "insane", POSITION, MOVES)
        with self.assertRaises(ai.AIError):
            c.choose_move("chess", "medium", "", MOVES)
        with self.assertRaises(ai.AIError):
            c.choose_move("chess", "medium", POSITION, [])

    def test_no_key(self):
        with self.assertRaisesRegex(ai.AIError, "Falta a chave"):
            ai.AIClient("claude-sonnet-5-5").choose_move("chess", "medium", POSITION, MOVES)

    def test_every_game_has_a_prompt(self):
        for game in ("chess", "checkers", "tictactoe", "connect4", "reversi", "cards"):
            for level in ("easy", "medium", "hard"):
                self.assertIn("play_move", ai.system_prompt(game, level))


if __name__ == "__main__":
    unittest.main()

"""Asks the AI for its move. Claude (Messages) or OpenAI (Responses), over plain HTTP (urllib).

The screen knows the rules: it sends the position as text and the list of legal moves. The model answers
by calling the `play_move` tool, whose schema only accepts one of those moves (`enum` + `strict`), so an
illegal move cannot come back. If the model still fails to pick one after a nudge, a random legal move is
played and the screen says so.

The model id decides the side (provedor.py). When one side runs out of credit, the same request is made
again with the pair model on the other side, and the empty side rests for 30 minutes (provedor.Disjuntor).
"""

from __future__ import annotations

import json
import logging
import random
import time
import urllib.error
import urllib.request

import provedor
from provedor import Disjuntor, eh_claude, provedor_de, reserva_de

URL_OPENAI = "https://api.openai.com/v1/responses"
URL_CLAUDE = "https://api.anthropic.com/v1/messages"
ATTEMPTS = 3
MAX_OUTPUT = 16000
MAX_OUTPUT_LONG = 64000     # the Impossible level thinks at max effort and needs room

# Models that provedor.py (identical copy of the master in contato-ia) does not price yet:
# (input, cache read, cache write 5 min, output) in US$ per 1M tokens, from the Claude API pricing table.
EXTRA_PRICES = {"claude-fable-5-2": (8.00, 0.20, 10.00, 40.00)}
MAX_MOVES = 400
MAX_POSITION = 20000
TOOL_NAME = "play_move"

# Server-side refusal fallback (beta). Only the models that accept `fallbacks: "default"`.
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_FALLBACK_MODELS = ("claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1")

log = logging.getLogger(__name__)


class AIError(Exception):
    """Error with a message ready to show on screen."""


class NoCreditError(AIError):
    """One side (OpenAI or Claude) ran out of credit or hit its spending cap."""


_SIDES = {"openai": "OpenAI", "claude": "Claude"}

# ── What each game is, for the model ─────────────────────────────────────────

GAMES = {
    "chess": (
        "Chess, standard FIDE rules. You get the position as FEN plus a board drawing (uppercase = White, "
        "lowercase = Black), the moves so far, and the legal moves in SAN. Think about material, king safety, "
        "threats against you and tactics before choosing."
    ),
    "checkers": (
        "Brazilian checkers (damas brasileiras) on an 8x8 board: men move one square diagonally forward and "
        "capture both forward and backward; capturing is mandatory and you must take the sequence that captures "
        "the most pieces; kings fly (move and capture along a whole diagonal); a man is crowned only when its move "
        "ends on the far row. Moves are written as squares from-to (`c3-d4`) or with every landing square of a "
        "capture (`c3xe5xg7`). Squares use files a-h and ranks 1-8; rank 1 is the bottom of the drawing."
    ),
    "tictactoe": (
        "Tic-tac-toe on a 3x3 grid. Cells are named A1 to C3 (letter = column, number = row, row 1 on top). "
        "Three in a row in any line wins. Perfect play from both sides is a draw."
    ),
    "connect4": (
        "Four in a row on a board 7 columns wide and 6 rows tall. A move is a column number (1 to 7); the disc "
        "falls to the lowest empty cell. Four of your discs in a line (horizontal, vertical or diagonal) wins."
    ),
    "reversi": (
        "Reversi on an 8x8 board. A move places a disc so that it brackets one or more straight lines of the "
        "opponent's discs between it and another of your discs; every bracketed disc flips to your color. With no "
        "legal placement you must pass. When neither side can move, the one with more discs wins. Corners can "
        "never be flipped; squares next to an empty corner are risky."
    ),
    "cards": (
        "Bate-Cor, a shedding card game for two. Each card has a color (coral, teal, mustard or olive) and a "
        "number 0-9, or is an action: Skip (the opponent loses their turn), +2 (the opponent draws two and loses "
        "their turn), Wild (you choose the next color) and Wild +4 (you choose the color, the opponent draws four "
        "and loses their turn). You may play a card that matches the color or the number/symbol of the top card, "
        "or any Wild. If you cannot or do not want to play, you draw one card; if that card can be played you may "
        "play it, otherwise you pass. Whoever empties their hand first wins. You only see your own hand."
    ),
}

# How Claude is told to play at each level. The model and effort are the same for every level (config.py);
# only this text changes. Easy and medium describe a weaker player of that specific game, who makes bad
# moves on purpose but does not throw the game.
BEGINNER = {
    "chess": (
        "a beginner who only knows how the pieces move and nothing else: no openings, no tactics, no strategy. "
        "Move pieces without a plan, push random pawns, bring the queen out early, leave pieces undefended, forget "
        "to castle and miss most forks, pins and threats against you"
    ),
    "checkers": (
        "a beginner who only knows the rules: move pieces without a plan, leave gaps in your back row, walk into "
        "exchanges that lose material, ignore the race to get kings and miss most of the opponent's threats"
    ),
    "tictactoe": (
        "a young child who just learned the game: place your mark almost anywhere, never plan forks, and often "
        "forget to block the person's two in a row"
    ),
    "connect4": (
        "a beginner: drop discs without a plan, do not set up threats, and often fail to notice when the person "
        "has three in a row"
    ),
    "reversi": (
        "a beginner: always grab the move that flips the most discs right now, have no idea that corners and edges "
        "matter, and happily play next to an empty corner"
    ),
    "cards": (
        "a beginner: play the first card you see that fits, spend Wild cards and action cards right away instead of "
        "saving them, and choose the Wild color without thinking much about your hand"
    ),
}

AMATEUR = {
    "chess": "knows the basic principles (develop pieces, castle, do not hang pieces) but does not calculate deeply",
    "checkers": "knows the basic ideas (keep pieces together, guard the back row) but does not calculate deeply",
    "tictactoe": "blocks the obvious threats but does not always see forks coming",
    "connect4": "blocks the obvious three in a row but does not plan threats several moves ahead",
    "reversi": "knows that corners are good but still trades long-term position for flipping many discs",
    "cards": "holds on to Wild cards for a while but does not track which colors the person is missing",
}


def style(game: str, difficulty: str) -> str:
    if difficulty == "easy":
        return (
            f"Play like {BEGINNER[game]}. Make bad moves on purpose: most of the time choose a weak or aimless move, "
            "not the best one, even when you can see the best one. But do not throw the game: if a win is right in "
            "front of you (a winning move, a piece left hanging that anyone would notice), take it, and do not make "
            "absurd moves just to lose."
        )
    if difficulty == "medium":
        return (
            f"Play like an average casual player who {AMATEUR[game]}. Now and then (about one move in three) choose "
            "a reasonable but clearly weaker move on purpose instead of the best one. Still try to win, and do not "
            "throw the game."
        )
    if difficulty == "impossible":
        return (
            "This is the hardest level: play perfectly. Take all the time you need. Calculate every critical line "
            "deeply, look at every forcing move for both sides (captures, threats, checks, wins, blocks), check what "
            "the opponent's best answer is to each candidate, and choose the strongest move there is. Never leave a "
            "chance for the opponent that you could have avoided."
        )
    return (
        "Play as strongly as you can. Calculate the critical lines, look at every forcing move (captures, threats, "
        "checks, wins), consider what the opponent will answer and choose the best move you can find."
    )


DIFFICULTIES = ("easy", "medium", "hard", "impossible")


def system_prompt(game: str, difficulty: str) -> str:
    return f"""You are playing a game against a person in a game app. You play your own side.

Game: {GAMES[game]}

How to play: {style(game, difficulty)}

You always answer by calling the `{TOOL_NAME}` tool once with exactly one of the legal moves you were given, written exactly as listed. Do not answer in text."""


def user_message(position: str, moves: list[str]) -> str:
    listed = "\n".join(f"- {m}" for m in moves)
    return f"{position.strip()}\n\nYour legal moves:\n{listed}\n\nCall `{TOOL_NAME}` with your move."


def tool_schema(moves: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {"move": {"type": "string", "enum": list(moves),
                                "description": "Your move, exactly as written in the list of legal moves."}},
        "required": ["move"],
        "additionalProperties": False,
    }


def clean_request(game, difficulty, position, moves) -> tuple[str, str, str, list[str]]:
    game = str(game or "")
    if game not in GAMES:
        raise AIError("Jogo desconhecido.")
    difficulty = str(difficulty or "")
    if difficulty not in DIFFICULTIES:
        raise AIError("Dificuldade desconhecida.")
    position = str(position or "").strip()
    if not position or len(position) > MAX_POSITION:
        raise AIError("A posição veio vazia ou grande demais.")
    if not isinstance(moves, list):
        raise AIError("A lista de lances veio num formato errado.")
    seen, clean = set(), []
    for m in moves:
        m = str(m or "").strip()[:60]
        if m and m not in seen:
            seen.add(m)
            clean.append(m)
    if not clean:
        raise AIError("Não tem lance legal para a IA escolher.")
    if len(clean) > MAX_MOVES:
        raise AIError("Lances demais na lista.")
    return game, difficulty, position, clean


class AIClient:
    def __init__(self, model: str, effort: str = "medium", fallback: str = "auto", *,
                 claude_key: str = "", openai_key: str = "", url_claude: str = URL_CLAUDE,
                 url_openai: str = URL_OPENAI, timeout: float = 300, breaker: Disjuntor | None = None,
                 max_output: int = MAX_OUTPUT):
        self.model = model
        self.effort = effort
        self.fallback_setting = fallback
        self.claude_key = claude_key
        self.openai_key = openai_key
        self.url_claude = url_claude
        self.url_openai = url_openai
        self.timeout = timeout
        self.max_output = max_output
        self.breaker = breaker or Disjuntor()

    # ── Which model answers ───────────────────────────────────────────────

    def has_key_for(self, model: str) -> bool:
        return bool(self.claude_key if eh_claude(model) else self.openai_key)

    def fallback(self) -> str | None:
        return reserva_de(self.model, self.fallback_setting)

    def order(self) -> list[str]:
        main, spare = self.model, self.fallback()
        candidates = [m for m in (main, spare) if m and self.has_key_for(m)]
        if len(candidates) == 2 and self.breaker.aberto(provedor_de(main)):
            candidates.reverse()
        return candidates

    # ── Public entry point ────────────────────────────────────────────────

    def choose_move(self, game: str, difficulty: str, position: str, moves: list[str]) -> dict:
        game, difficulty, position, moves = clean_request(game, difficulty, position, moves)
        if len(moves) == 1:
            return {"move": moves[0], "model": None, "cost": 0.0, "replaced": False, "random": False, "forced": True}
        order = self.order()
        if not order:
            raise AIError("Falta a chave da IA. Abra Configurações e cole a chave da Anthropic.")
        failures: list[NoCreditError] = []
        for model in order:
            try:
                if eh_claude(model):
                    move, usage = self._claude(model, game, difficulty, position, moves)
                else:
                    move, usage = self._openai(model, game, difficulty, position, moves)
            except NoCreditError as e:
                self.breaker.abrir(provedor_de(model))
                failures.append(e)
                continue
            picked_randomly = move not in moves
            if picked_randomly:
                move = random.choice(moves)
            return {"move": move, "model": model, "cost": cost_of(model, usage),
                    "replaced": model != self.model, "random": picked_randomly, "forced": False}
        if len(failures) == 1:
            spare = self.fallback()
            extra = (" Sem chave do outro lado para trocar." if spare and not self.has_key_for(spare)
                     else " Sem reserva configurada." if not spare else "")
            raise NoCreditError(f"{failures[0]}{extra}")
        raise NoCreditError("Os dois lados ficaram sem crédito. " + " ".join(str(f) for f in failures))

    # ── Claude ────────────────────────────────────────────────────────────

    def _claude(self, model, game, difficulty, position, moves) -> tuple[str | None, dict]:
        system = [{"type": "text", "text": system_prompt(game, difficulty), "cache_control": provedor.CACHE}]
        messages: list[dict] = [{"role": "user", "content": [{"type": "text", "text": user_message(position, moves)}]}]
        function = {"type": "function", "name": TOOL_NAME, "description": "Play your move.",
                    "parameters": tool_schema(moves)}
        usage_total = _empty_usage()
        headers = {"x-api-key": self.claude_key, "anthropic-version": provedor.ANTHROPIC_VERSAO}
        for round_ in range(2):
            body = provedor.corpo_claude(model, system, messages, self.effort, self.max_output, ferramentas=[function])
            body["tools"][0]["strict"] = True
            extra_headers = dict(headers)
            if model.lower().startswith(_FALLBACK_MODELS):
                body["fallbacks"] = "default"
                extra_headers["anthropic-beta"] = FALLBACK_BETA
            data = self._post("claude", self.url_claude, extra_headers, body)
            _add_usage(usage_total, provedor.uso_normalizado(data.get("usage")) or {})
            answer = provedor.ler_resposta_claude(data)
            for call in answer.chamadas:
                if call.get("name") == TOOL_NAME:
                    move = str((call.get("input") or {}).get("move") or "").strip()
                    if move in moves:
                        return move, usage_total
            if answer.parada == "refusal":
                detail = (answer.detalhe or {}).get("explanation") or (answer.detalhe or {}).get("category") or "sem detalhe"
                raise AIError(f"O Claude ({model}) se recusou a jogar: {detail}")
            if answer.parada == "max_tokens":
                raise AIError("A resposta da IA foi cortada no meio (max_tokens). Tenta de novo.")
            if round_ == 1:
                break
            # Answered in text, or with a tool call that did not carry a legal move: one nudge.
            kept = [b for b in answer.blocos if b.get("type") in ("thinking", "redacted_thinking", "text", "tool_use")]
            if not any(b.get("type") in ("text", "tool_use") for b in kept):
                break
            messages.append({"role": "assistant", "content": kept})
            results = [{"type": "tool_result", "tool_use_id": c.get("id"), "is_error": True,
                        "content": "That is not one of the legal moves."} for c in answer.chamadas if c.get("id")]
            messages.append({"role": "user", "content": results + [{"type": "text", "text":
                             f"Call `{TOOL_NAME}` now with one move copied exactly from the list."}]})
        return None, usage_total

    # ── OpenAI ────────────────────────────────────────────────────────────

    def _openai(self, model, game, difficulty, position, moves) -> tuple[str | None, dict]:
        function = {"type": "function", "name": TOOL_NAME, "description": "Play your move.",
                    "parameters": tool_schema(moves), "strict": True}
        effort = self.effort if self.effort in ("low", "medium", "high") else "high"
        body = {"model": model, "instructions": system_prompt(game, difficulty),
                "input": user_message(position, moves), "tools": [function],
                "tool_choice": {"type": "function", "name": TOOL_NAME},
                "reasoning": {"effort": effort}, "max_output_tokens": self.max_output, "store": False}
        data = self._post("openai", self.url_openai, {"Authorization": f"Bearer {self.openai_key}"}, body)
        usage = _empty_usage()
        _add_usage(usage, data.get("usage") or {})
        for item in data.get("output") or []:
            if item.get("type") == "function_call" and item.get("name") == TOOL_NAME:
                try:
                    move = str(json.loads(item.get("arguments") or "{}").get("move") or "").strip()
                except (ValueError, AttributeError):
                    move = ""
                if move in moves:
                    return move, usage
        return None, usage

    # ── Network ───────────────────────────────────────────────────────────

    def _post(self, side: str, url: str, headers: dict, body: dict) -> dict:
        name = _SIDES[side]
        payload = json.dumps(body).encode("utf-8")
        for attempt in range(ATTEMPTS):
            last = attempt == ATTEMPTS - 1
            req = urllib.request.Request(url, data=payload, method="POST",
                                         headers={**headers, "content-type": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return _read_json(resp.read())
            except urllib.error.HTTPError as e:
                status = e.code
                data = _read_json(e.read())
                retry_after = e.headers.get("Retry-After") if e.headers else None
            except TimeoutError as e:
                raise AIError(f"O {name} demorou mais de {int(self.timeout)}s e eu desisti.") from e
            except urllib.error.URLError as e:
                if isinstance(e.reason, TimeoutError):
                    raise AIError(f"O {name} demorou mais de {int(self.timeout)}s e eu desisti.") from e
                # Never connected, so nothing was sent or charged: safe to try again.
                if not last:
                    time.sleep(2 ** attempt)
                    continue
                raise AIError(f"Não consegui conectar no {name}. A internet caiu?") from e
            except OSError as e:
                raise AIError(f"A conexão com o {name} caiu no meio: {e}") from e
            if provedor.falta_de_credito(status, data):
                raise NoCreditError(f"O {name} ficou sem crédito ({_detail(data)}).")
            if (status == 429 or status >= 500) and not last:
                time.sleep(_wait_seconds(retry_after, attempt))
                continue
            raise AIError(_error_message(name, status, data))
        raise AIError(f"Depois de três tentativas o {name} continuou sem responder.")


def cost_of(model: str, usage: dict) -> float | None:
    cost = provedor.custo(model, usage)
    if cost is not None or not usage:
        return cost
    price = EXTRA_PRICES.get(str(model or "").lower())
    if not price:
        return None
    full, read, write, out = price
    total = int(usage.get("input_tokens") or 0)
    details = usage.get("input_tokens_details") or {}
    cached = min(int(details.get("cached_tokens") or 0), total)
    written = min(int(details.get("cache_write_tokens") or 0), total - cached)
    return ((total - cached - written) * full + cached * read + written * write
            + int(usage.get("output_tokens") or 0) * out) / 1_000_000


def _empty_usage() -> dict:
    return {"input_tokens": 0, "output_tokens": 0, "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0}}


def _add_usage(total: dict, usage: dict) -> None:
    total["input_tokens"] += int(usage.get("input_tokens") or 0)
    total["output_tokens"] += int(usage.get("output_tokens") or 0)
    details = usage.get("input_tokens_details") or {}
    total["input_tokens_details"]["cached_tokens"] += int(details.get("cached_tokens") or 0)
    total["input_tokens_details"]["cache_write_tokens"] += int(details.get("cache_write_tokens") or 0)


def _read_json(raw: bytes) -> dict:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _wait_seconds(retry_after, attempt: int) -> float:
    try:
        return min(30.0, max(0.0, float(retry_after)))
    except (TypeError, ValueError):
        return float(2 ** attempt)


def _detail(data: dict) -> str:
    error = data.get("error")
    if isinstance(error, dict):
        return error.get("message") or "sem detalhe"
    return str(error or "sem detalhe")


def _error_message(name: str, status: int, data: dict) -> str:
    detail = _detail(data)
    if status == 401:
        return f"O {name} recusou a chave (401). Confere a chave em Configurações."
    if status == 429:
        return f"O {name} limitou os pedidos (429): {detail}"
    if status == 404:
        return f"O {name} não achou o modelo (404): {detail}"
    if status == 529:
        return f"O {name} está sobrecarregado agora (529). Tenta daqui a pouco."
    return f"O {name} respondeu erro {status}: {detail}"

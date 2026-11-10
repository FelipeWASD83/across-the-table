// Rules of the six games, without a browser: node --test tests/js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import tictactoe from '../../app/js/games/tictactoe.js';
import connect4 from '../../app/js/games/connect4.js';
import reversi from '../../app/js/games/reversi.js';
import checkers, { legalSequences } from '../../app/js/games/checkers.js';
import chess from '../../app/js/games/chess.js';
import cards from '../../app/js/games/cards.js';

const ALL = [tictactoe, connect4, reversi, checkers, chess, cards];

function randomPlayout(game, humanFirst, limit = 600) {
  let state = game.create(humanFirst);
  for (let ply = 0; ply < limit; ply++) {
    const result = game.outcome(state);
    if (result) return { state, result, ply };
    const moves = game.moves(state);
    assert.ok(moves.length > 0, `${game.id}: no moves but no result`);
    assert.equal(new Set(moves).size, moves.length, `${game.id}: repeated move ids`);
    for (const m of moves) assert.equal(typeof m, 'string');
    const before = JSON.stringify(state);
    const pick = moves[Math.floor(Math.random() * moves.length)];
    game.notation(state, pick);
    const next = game.play(state, pick);
    assert.equal(JSON.stringify(state), before, `${game.id}: play() changed the old state`);
    assert.equal(typeof game.describe(next), 'string');
    state = next;
  }
  return { state, result: game.outcome(state), ply: limit };
}

for (const game of ALL) {
  const games = game.id === 'chess' ? 12 : 40;
  test(`${game.id}: ${games} random games end without breaking the rules engine`, () => {
    let finished = 0;
    for (let i = 0; i < games; i++) {
      const { result } = randomPlayout(game, i % 2 === 0, game.id === 'cards' ? 3000 : 700);
      if (result) {
        finished++;
        assert.ok(['human', 'claude', 'draw'].includes(result.winner));
      }
    }
    // Random chess and checkers can run long; most games still have to finish.
    assert.ok(finished >= games * 0.75, `${game.id}: only ${finished} of ${games} finished`);
  });
}

test('tictactoe: row wins, blocked board is a draw', () => {
  let s = tictactoe.create(true);
  for (const m of ['A1', 'A2', 'B1', 'B2', 'C1']) s = tictactoe.play(s, m);
  assert.equal(tictactoe.outcome(s).winner, 'human');
  s = tictactoe.create(true);
  for (const m of ['A1', 'B1', 'C1', 'B2', 'A2', 'C2', 'B3', 'A3', 'C3']) s = tictactoe.play(s, m);
  assert.equal(tictactoe.outcome(s).winner, 'draw');
});

test('connect4: diagonal win and full column is not legal', () => {
  let s = connect4.create(true);
  for (const m of ['1', '2', '2', '3', '3', '4', '3', '4', '4', '7', '4']) s = connect4.play(s, m);
  assert.equal(connect4.outcome(s).winner, 'human');
  s = connect4.create(true);
  for (let i = 0; i < 6; i++) s = connect4.play(s, '1');
  assert.ok(!connect4.moves(s).includes('1'));
});

test('reversi: opening has four moves and flips one disc', () => {
  const s = reversi.create(true);
  assert.deepEqual(reversi.moves(s).sort(), ['c4', 'd3', 'e6', 'f5']);
  const n = reversi.play(s, 'd3');
  assert.deepEqual(reversi.score(n), { human: 4, claude: 1 });
});

function emptyCheckers(turn = 'human') {
  return { board: Array.from({ length: 8 }, () => Array(8).fill(null)), turn, white: 'human', last: null, quiet: 0 };
}
function put(state, square, who, king = false) {
  state.board[Number(square[1]) - 1]['abcdefgh'.indexOf(square[0])] = { who, king };
}

test('checkers: capture is mandatory and backwards capture works', () => {
  const s = emptyCheckers();
  put(s, 'c3', 'human');
  put(s, 'g3', 'human');
  put(s, 'b2', 'claude'); // behind c3
  put(s, 'h8', 'claude');
  assert.deepEqual(checkers.moves(s), ['c3xa1']);
});

test('checkers: the sequence that takes most pieces must be played', () => {
  const s = emptyCheckers();
  put(s, 'a1', 'human');
  put(s, 'e1', 'human');
  put(s, 'b2', 'claude');
  put(s, 'f2', 'claude');
  put(s, 'f4', 'claude');
  put(s, 'h8', 'claude');
  // a1 takes one (b2). e1 takes f2 then f4: two.
  assert.deepEqual(checkers.moves(s), ['e1xg3xe5']);
});

test('checkers: flying king captures from a distance and lands anywhere beyond', () => {
  const s = emptyCheckers();
  put(s, 'a1', 'human', true);
  put(s, 'd4', 'claude');
  put(s, 'h8', 'claude', true);
  const moves = checkers.moves(s).sort();
  assert.deepEqual(moves, ['a1xe5', 'a1xf6', 'a1xg7']);
});

test('checkers: a man passing the last row mid-capture is not crowned', () => {
  const s = emptyCheckers();
  put(s, 'b6', 'human');
  put(s, 'c7', 'claude');
  put(s, 'e7', 'claude');
  put(s, 'a1', 'claude');
  const seqs = legalSequences(s.board, 'human');
  assert.deepEqual(seqs.map((x) => x.id), ['b6xd8xf6']);
  const n = checkers.play(s, 'b6xd8xf6');
  assert.equal(n.board[5][5].king, false);
  const crown = emptyCheckers();
  put(crown, 'c7', 'human');
  put(crown, 'a1', 'claude');
  const after = checkers.play(crown, 'c7-d8');
  assert.equal(after.board[7][3].king, true);
});

test('chess: scholar mate is checkmate for the side that mated', () => {
  let s = chess.create(true);
  for (const m of ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']) s = chess.play(s, m);
  assert.deepEqual(chess.outcome(s), { winner: 'human', reason: 'xeque-mate' });
  assert.match(chess.describe({ ...s, turn: 'claude' }), /FEN: /);
});

test('cards: deal, color rule and wild ids', () => {
  const s = cards.create(true);
  assert.equal(s.hands.human.length, 7);
  assert.equal(s.hands.claude.length, 7);
  assert.equal(s.deck.length + s.discard.length + 14, 100);
  assert.equal(cards.top(s).kind, 'num');
  const moves = cards.moves(s);
  assert.equal(moves[moves.length - 1], 'draw');
  const forced = { ...s, hands: { human: [{ id: 'w', color: null, kind: 'wild', value: null }, { id: 'x', color: 'teal', kind: 'num', value: 3 }], claude: s.hands.claude } };
  const ids = cards.moves(forced).filter((m) => m.startsWith('play wild'));
  assert.equal(ids.length, 4);
  const after = cards.play(forced, 'play wild, choose olive');
  assert.equal(after.color, 'olive');
  assert.equal(after.turn, 'claude');
});

test('cards: +2 makes the other draw and keeps the turn', () => {
  const s = cards.create(true);
  const top = cards.top(s);
  const plus = { id: 'p2', color: top.color, kind: 'draw2', value: null };
  const forced = { ...s, hands: { human: [plus, { id: 'z', color: 'coral', kind: 'num', value: 1 }], claude: s.hands.claude.slice() } };
  const after = cards.play(forced, `play ${top.color} +2`);
  assert.equal(after.hands.claude.length, 9);
  assert.equal(after.turn, 'human');
});

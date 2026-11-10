// Bate-Cor: a two-player shedding card game. 100 cards: per color one 0, two of each 1-9, two Skip and two +2;
// plus four Wild and four Wild +4. Match the color or the number/symbol of the top card, or play any Wild.
// No legal card (or no wish to play): draw one; if it can be played you may play it or pass.
//
// Move ids (what Claude picks from): "play coral 7", "play teal skip", "play olive +2",
// "play wild, choose mustard", "play wild +4, choose coral", "draw", "pass".

export const COLORS = ['coral', 'teal', 'mustard', 'olive'];
export const COLOR_NAMES = { coral: 'coral', teal: 'petróleo', mustard: 'mostarda', olive: 'oliva' };
const HAND = 7;
const other = (who) => (who === 'human' ? 'claude' : 'human');

function newDeck() {
  const deck = [];
  let n = 0;
  const add = (color, kind, value = null) => deck.push({ id: `k${n++}`, color, kind, value });
  for (const color of COLORS) {
    add(color, 'num', 0);
    for (let v = 1; v <= 9; v++) { add(color, 'num', v); add(color, 'num', v); }
    for (let i = 0; i < 2; i++) { add(color, 'skip'); add(color, 'draw2'); }
  }
  for (let i = 0; i < 4; i++) { add(null, 'wild'); add(null, 'wild4'); }
  return deck;
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function describeCard(card) {
  if (card.kind === 'wild') return 'wild';
  if (card.kind === 'wild4') return 'wild +4';
  const face = card.kind === 'num' ? String(card.value) : card.kind === 'skip' ? 'skip' : '+2';
  return `${card.color} ${face}`;
}

export function cardLabel(card) {
  if (card.kind === 'wild') return 'Curinga';
  if (card.kind === 'wild4') return 'Curinga +4';
  const face = card.kind === 'num' ? String(card.value) : card.kind === 'skip' ? 'Pular' : '+2';
  return `${face} ${COLOR_NAMES[card.color]}`;
}

function canPlay(card, top, color) {
  if (card.kind === 'wild' || card.kind === 'wild4') return true;
  if (card.color === color) return true;
  if (card.kind === 'num') return top.kind === 'num' && top.value === card.value;
  return card.kind === top.kind;
}

function idsFor(card) {
  const base = `play ${describeCard(card)}`;
  if (card.kind === 'wild' || card.kind === 'wild4') return COLORS.map((c) => `${base}, choose ${c}`);
  return [base];
}

function parseId(id) {
  const m = /^play (.+?)(?:, choose (\w+))?$/.exec(id);
  return m ? { desc: m[1], color: m[2] || null } : null;
}

function drawCards(state, who, n) {
  for (let i = 0; i < n; i++) {
    if (!state.deck.length) {
      const top = state.discard.pop();
      state.deck = shuffle(state.discard);
      state.discard = [top];
      if (!state.deck.length) return;
    }
    state.hands[who].push(state.deck.pop());
  }
}

function clone(state) {
  return {
    ...state,
    deck: state.deck.slice(),
    discard: state.discard.slice(),
    hands: { human: state.hands.human.slice(), claude: state.hands.claude.slice() },
    feed: state.feed.slice(),
  };
}

export default {
  id: 'cards',
  name: 'Bate-Cor',
  blurb: 'Cartas de cor e número. Quem esvazia a mão primeiro ganha.',
  pieces: { human: 'Cartas', claude: 'Cartas' },

  create(humanFirst) {
    let deck = shuffle(newDeck());
    const hands = { human: [], claude: [] };
    for (let i = 0; i < HAND; i++) { hands.human.push(deck.pop()); hands.claude.push(deck.pop()); }
    // The first card on the table is always a number.
    let idx = deck.length - 1;
    while (deck[idx].kind !== 'num') idx--;
    const [first] = deck.splice(idx, 1);
    deck = shuffle(deck);
    return { deck, discard: [first], hands, color: first.color, turn: humanFirst ? 'human' : 'claude',
      phase: 'play', drawn: null, last: null, feed: [] };
  },

  top(state) {
    return state.discard[state.discard.length - 1];
  },

  moves(state) {
    if (this.outcome(state)) return [];
    const top = this.top(state);
    const hand = state.hands[state.turn];
    if (state.phase === 'drawn') {
      const card = hand.find((c) => c.id === state.drawn);
      return [...(card && canPlay(card, top, state.color) ? idsFor(card) : []), 'pass'];
    }
    const ids = [];
    for (const card of hand) if (canPlay(card, top, state.color)) ids.push(...idsFor(card));
    return [...new Set(ids), 'draw'];
  },

  // Which card in hand a move plays (the first one that matches the description).
  cardFor(state, id) {
    const parsed = parseId(id);
    if (!parsed) return null;
    const hand = state.hands[state.turn];
    if (state.phase === 'drawn') return hand.find((c) => c.id === state.drawn) || null;
    return hand.find((c) => describeCard(c) === parsed.desc) || null;
  },

  play(state, id) {
    const s = clone(state);
    const who = s.turn;
    const foe = other(who);
    if (id === 'draw') {
      const before = s.hands[who].length;
      drawCards(s, who, 1);
      const card = s.hands[who][s.hands[who].length - 1];
      s.feed.push({ who, action: 'draw' });
      if (s.hands[who].length > before && canPlay(card, this.top(s), s.color)) {
        s.phase = 'drawn';
        s.drawn = card.id;
      } else {
        s.turn = foe;
        s.phase = 'play';
        s.drawn = null;
      }
      s.last = { who, action: 'draw' };
      return s;
    }
    if (id === 'pass') {
      s.feed.push({ who, action: 'pass' });
      s.turn = foe;
      s.phase = 'play';
      s.drawn = null;
      s.last = { who, action: 'pass' };
      return s;
    }
    const parsed = parseId(id);
    const card = this.cardFor(state, id);
    if (!card) throw new Error(`Carta que não está na mão: ${id}`);
    s.hands[who] = s.hands[who].filter((c) => c.id !== card.id);
    s.discard.push(card);
    s.color = card.color || parsed.color;
    s.phase = 'play';
    s.drawn = null;
    let keep = false;
    if (card.kind === 'skip') keep = true;
    if (card.kind === 'draw2') { drawCards(s, foe, 2); keep = true; }
    if (card.kind === 'wild4') { drawCards(s, foe, 4); keep = true; }
    s.feed.push({ who, action: 'play', card, chose: card.color ? null : parsed.color });
    s.turn = keep && s.hands[who].length ? who : foe;
    s.last = { who, action: 'play', card: card.id };
    return s;
  },

  notation(state, id) {
    if (id === 'draw') return 'compra';
    if (id === 'pass') return 'passa';
    const card = this.cardFor(state, id);
    const parsed = parseId(id);
    if (!card) return id;
    return cardLabel(card) + (parsed?.color && !card.color ? ` → ${COLOR_NAMES[parsed.color]}` : '');
  },

  outcome(state) {
    if (!state.hands.human.length) return { winner: 'human', reason: 'mão vazia' };
    if (!state.hands.claude.length) return { winner: 'claude', reason: 'mão vazia' };
    return null;
  },

  describe(state) {
    const top = this.top(state);
    const hand = state.hands.claude.map(describeCard).sort().join(', ');
    const recent = state.feed.slice(-6).map((f) => `${f.who === 'claude' ? 'You' : 'The person'}: ${feedText(f, 'en')}`);
    const justDrawn = state.phase === 'drawn' ? state.hands.claude.find((c) => c.id === state.drawn) : null;
    const drawn = justDrawn ? `\nYou just drew ${describeCard(justDrawn)}. You may play it now or pass.` : '';
    return `Top card: ${describeCard(top)}. Color to match: ${state.color}.\nYour hand (${state.hands.claude.length} cards): ${hand}.\nThe person has ${state.hands.human.length} cards. Draw pile: ${state.deck.length} cards.${drawn}\n\nRecent plays:\n${recent.join('\n') || '(none yet)'}`;
  },

  render(el, state, ui) {
    const local = ui.local;
    if (local.state !== state) {
      local.state = state;
      local.wild = null;
    }
    const legal = new Set(ui.canAct ? this.moves(state) : []);
    const top = this.top(state);
    el.innerHTML = '';
    const table = document.createElement('div');
    table.className = 'cards-table';

    const theirs = document.createElement('div');
    theirs.className = 'hand hand-hidden';
    theirs.setAttribute('aria-label', `Mão do Claude: ${state.hands.claude.length} cartas`);
    for (let i = 0; i < state.hands.claude.length; i++) theirs.appendChild(cardBack());
    table.appendChild(theirs);

    const middle = document.createElement('div');
    middle.className = 'pile-row';
    const deckBtn = document.createElement('button');
    deckBtn.type = 'button';
    deckBtn.className = 'pile';
    deckBtn.appendChild(cardBack());
    const deckLabel = document.createElement('span');
    deckLabel.className = 'pile-label';
    deckLabel.textContent = legal.has('draw') ? `Comprar (${state.deck.length})` : `Monte (${state.deck.length})`;
    deckBtn.appendChild(deckLabel);
    if (legal.has('draw')) deckBtn.addEventListener('click', () => ui.onMove('draw'));
    else deckBtn.disabled = true;
    middle.appendChild(deckBtn);

    const discard = document.createElement('div');
    discard.className = 'pile pile-discard';
    discard.appendChild(cardFace(top, state.color));
    const colorTag = document.createElement('span');
    colorTag.className = 'pile-label';
    colorTag.innerHTML = `Vale <b data-color="${state.color}">${COLOR_NAMES[state.color]}</b>`;
    discard.appendChild(colorTag);
    middle.appendChild(discard);

    if (legal.has('pass')) {
      const pass = document.createElement('button');
      pass.type = 'button';
      pass.className = 'btn';
      pass.textContent = 'Passar a vez';
      pass.addEventListener('click', () => ui.onMove('pass'));
      middle.appendChild(pass);
    }
    table.appendChild(middle);

    const mine = document.createElement('div');
    mine.className = 'hand hand-mine';
    for (const card of sortHand(state.hands.human)) {
      const ids = idsFor(card).filter((id) => legal.has(id));
      const playable = ids.length > 0 && (state.phase !== 'drawn' || card.id === state.drawn);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hand-card';
      btn.setAttribute('aria-label', cardLabel(card));
      btn.appendChild(cardFace(card));
      if (card.id === state.drawn) btn.classList.add('is-drawn');
      if (playable) {
        btn.classList.add('is-playable');
        btn.addEventListener('click', () => {
          if (ids.length > 1) {
            local.wild = card.id;
            ui.redraw();
          } else ui.onMove(ids[0]);
        });
      } else btn.disabled = true;
      if (local.wild === card.id) {
        btn.classList.add('is-selected');
        const pick = document.createElement('div');
        pick.className = 'color-pick';
        pick.setAttribute('role', 'group');
        pick.setAttribute('aria-label', 'Escolher a cor');
        for (const color of COLORS) {
          const c = document.createElement('span');
          c.className = 'color-dot';
          c.dataset.color = color;
          c.title = COLOR_NAMES[color];
          c.tabIndex = 0;
          c.setAttribute('role', 'button');
          c.setAttribute('aria-label', `Escolher ${COLOR_NAMES[color]}`);
          const choose = (ev) => {
            ev.stopPropagation();
            ui.onMove(`play ${describeCard(card)}, choose ${color}`);
          };
          c.addEventListener('click', choose);
          c.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') choose(ev); });
          pick.appendChild(c);
        }
        btn.appendChild(pick);
      }
      mine.appendChild(btn);
    }
    table.appendChild(mine);
    el.appendChild(table);
  },
};

// One line of the play log, in Portuguese for the screen or English for Claude.
export function feedText(f, lang = 'pt') {
  const en = lang === 'en';
  if (f.action === 'draw') return en ? 'drew a card' : 'comprou uma carta';
  if (f.action === 'pass') return en ? 'passed' : 'passou';
  const name = en ? describeCard(f.card) : cardLabel(f.card);
  const chose = f.chose ? (en ? ` and chose ${f.chose}` : ` e escolheu ${COLOR_NAMES[f.chose]}`) : '';
  const extra = f.card.kind === 'draw2' ? (en ? ' (the other player drew 2)' : ' (o outro comprou 2)')
    : f.card.kind === 'wild4' ? (en ? ' (the other player drew 4)' : ' (o outro comprou 4)') : '';
  return `${en ? 'played' : 'jogou'} ${name}${chose}${extra}`;
}

function sortHand(hand) {
  const order = (c) => (c.color ? COLORS.indexOf(c.color) : 9) * 100 + (c.kind === 'num' ? c.value : c.kind === 'skip' ? 20 : c.kind === 'draw2' ? 21 : c.kind === 'wild' ? 30 : 31);
  return hand.slice().sort((a, b) => order(a) - order(b));
}

function cardBack() {
  const back = document.createElement('span');
  back.className = 'card card-back';
  back.setAttribute('aria-hidden', 'true');
  return back;
}

const SKIP_ICON = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="13"/><path d="m11 29 18-18"/></svg>';

export function cardFace(card, activeColor = null) {
  const face = document.createElement('span');
  face.className = 'card';
  face.dataset.kind = card.kind;
  face.dataset.color = card.color || 'wild';
  if (!card.color && activeColor) face.dataset.chosen = activeColor;
  let mark;
  if (card.kind === 'num') mark = String(card.value);
  else if (card.kind === 'draw2') mark = '+2';
  else if (card.kind === 'wild4') mark = '+4';
  else if (card.kind === 'skip') mark = SKIP_ICON;
  else mark = '';
  const corner = card.kind === 'skip' ? '' : mark;
  face.innerHTML = `<span class="card-corner">${corner}</span><span class="card-mark">${mark}</span>${card.color ? '' : '<span class="card-quad"><i></i><i></i><i></i><i></i></span>'}<span class="card-corner card-corner-end">${corner}</span>`;
  return face;
}

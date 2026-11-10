// Chess pieces drawn for this project: flat geometric silhouettes on a 100x100 grid, one stroke weight.
// White pieces are light with a dark outline; black pieces are dark with a light inner line.

const BASE = '<rect x="24" y="78" width="52" height="9" rx="3"/>';

const SHAPES = {
  p: `<circle cx="50" cy="33" r="12"/><path d="M40 78 44 50h12l4 28Z"/><rect x="38" y="46" width="24" height="6" rx="3"/>`,
  r: `<path d="M30 20h9v8h6v-8h10v8h6v-8h9v20H30Z"/><path d="M35 40h30l3 38H32Z"/>`,
  n: `<path d="M68 78H34c0-12 6-19 14-25-8 2-15 3-20-2-4-5 1-12 8-16 3-9 7-16 13-22l3 8c13 2 20 15 19 31-1 10-3 17-3 26Z"/><circle class="cut" cx="50" cy="31" r="3"/>`,
  b: `<circle cx="50" cy="14" r="5"/><path d="M50 19c11 9 15 22 9 33l3 26H38l3-26c-6-11-2-24 9-33Z"/><path class="cut-line" d="m55 30-9 11"/>`,
  q: `<path d="M26 30 37 56l5-30 8 26 8-26 5 30 11-26-8 48H34Z"/><circle cx="26" cy="28" r="4"/><circle cx="42" cy="23" r="4"/><circle cx="58" cy="23" r="4"/><circle cx="74" cy="28" r="4"/><circle cx="50" cy="20" r="4"/>`,
  k: `<path d="M47 8h6v8h7v6h-7v9h-6v-9h-7v-6h7Z"/><path d="M34 78 37 44c7-8 19-8 26 0l3 34Z"/>`,
};

function draw(type, color) {
  return `<svg class="piece" data-color="${color === 'w' ? 'white' : 'black'}" viewBox="0 0 100 100" aria-hidden="true">${SHAPES[type]}${BASE}</svg>`;
}

export const PIECES = Object.fromEntries(Object.keys(SHAPES).map((t) => [t, (color) => draw(t, color)]));

/** Mahjong tile definitions and helpers (Chinese 136-tile set, no flowers). */

const SUITS = ["man", "pin", "sou"];
const WINDS = ["east", "south", "west", "north"];
const DRAGONS = ["red", "green", "white"];

const LABELS = {
  man1: "一万", man2: "二万", man3: "三万", man4: "四万", man5: "五万",
  man6: "六万", man7: "七万", man8: "八万", man9: "九万",
  pin1: "一饼", pin2: "两饼", pin3: "三饼", pin4: "四饼", pin5: "五饼",
  pin6: "六饼", pin7: "七饼", pin8: "八饼", pin9: "九饼",
  sou1: "一条", sou2: "两条", sou3: "三条", sou4: "四条", sou5: "五条",
  sou6: "六条", sou7: "七条", sou8: "八条", sou9: "九条",
  east: "东", south: "南", west: "西", north: "北",
  red: "中", green: "发", white: "白",
};

const SHORT = {
  man1: "一万", man2: "两万", man3: "三万", man4: "四万", man5: "五万",
  man6: "六万", man7: "七万", man8: "八万", man9: "九万",
  pin1: "一饼", pin2: "两饼", pin3: "三饼", pin4: "四饼", pin5: "五饼",
  pin6: "六饼", pin7: "七饼", pin8: "八饼", pin9: "九饼",
  sou1: "一条", sou2: "两条", sou3: "三条", sou4: "四条", sou5: "五条",
  sou6: "六条", sou7: "七条", sou8: "八条", sou9: "九条",
  east: "东", south: "南", west: "西", north: "北",
  red: "中", green: "发", white: "白",
};

function createWall() {
  const wall = [];
  for (const suit of SUITS) {
    for (let n = 1; n <= 9; n++) {
      for (let c = 0; c < 4; c++) wall.push(`${suit}${n}`);
    }
  }
  for (const w of WINDS) for (let c = 0; c < 4; c++) wall.push(w);
  for (const d of DRAGONS) for (let c = 0; c < 4; c++) wall.push(d);
  return shuffle(wall);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortTiles(tiles) {
  const order = (t) => {
    // Check winds/dragons before "sou*" — "south" must not sort as bamboo
    const wi = WINDS.indexOf(t);
    if (wi >= 0) return 60 + wi;
    const di = DRAGONS.indexOf(t);
    if (di >= 0) return 70 + di;
    if (/^man[1-9]$/.test(t)) return 0 + Number(t.slice(3));
    if (/^pin[1-9]$/.test(t)) return 20 + Number(t.slice(3));
    if (/^sou[1-9]$/.test(t)) return 40 + Number(t.slice(3));
    return 99;
  };
  return [...tiles].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

function counts(tiles) {
  const m = Object.create(null);
  for (const t of tiles) m[t] = (m[t] || 0) + 1;
  return m;
}

function removeOne(tiles, tile) {
  const i = tiles.indexOf(tile);
  if (i < 0) return null;
  const next = tiles.slice();
  next.splice(i, 1);
  return next;
}

function removeN(tiles, tile, n) {
  let next = tiles;
  for (let i = 0; i < n; i++) {
    next = removeOne(next, tile);
    if (!next) return null;
  }
  return next;
}

function isSuitTile(t) {
  return /^man[1-9]$/.test(t) || /^pin[1-9]$/.test(t) || /^sou[1-9]$/.test(t);
}

function suitOf(t) {
  if (/^man[1-9]$/.test(t)) return "man";
  if (/^pin[1-9]$/.test(t)) return "pin";
  if (/^sou[1-9]$/.test(t)) return "sou";
  return null;
}

function rankOf(t) {
  if (!isSuitTile(t)) return null;
  return Number(t.slice(3));
}

function tileMeta(t) {
  const suit = suitOf(t);
  return {
    id: t,
    label: LABELS[t] || t,
    short: SHORT[t] || t,
    suit: suit || t,
    rank: rankOf(t),
    honor: !suit,
  };
}

module.exports = {
  SUITS,
  WINDS,
  DRAGONS,
  LABELS,
  SHORT,
  createWall,
  shuffle,
  sortTiles,
  counts,
  removeOne,
  removeN,
  isSuitTile,
  suitOf,
  rankOf,
  tileMeta,
};

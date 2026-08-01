/**
 * Simple mahjong scoring.
 * Win = 4 melds + 1 pair (平胡 / 鸡胡 OK — no minimum faan).
 * Points still scale with faan (2^faan, min 1). Discarder pays all; self-draw = all pay.
 */

const { counts, removeN, isSuitTile, suitOf, rankOf, WINDS, DRAGONS } = require("./tiles");
const { canFormMelds } = require("./hand");

/** 0 = any complete hand can win (including 平胡). */
const MIN_FAAN = 0;
const FAAN_CAP = 13;
const SEAT_WIND = ["east", "south", "west", "north"];

/** Points = 2^faan; 0-faan (鸡胡) counts as 1 faan for payout. */
function faanToPoints(faan) {
  const f = Math.max(1, Math.min(FAAN_CAP, faan));
  return 2 ** f;
}

function isHonor(t) {
  return WINDS.includes(t) || DRAGONS.includes(t);
}

function openMeldsNormalized(openMelds) {
  return openMelds.map((m) => ({
    type: m.type === "chi" ? "chow" : m.type === "kong" ? "kong" : "pong",
    tiles: m.tiles,
    open: true,
    tile: m.type === "chi" ? m.tiles[0] : m.tiles[0],
  }));
}

/**
 * All ways to partition tiles into melds.
 * Important: explore BOTH pung and chow when the smallest tile has 3+ copies
 * (e.g. 111222333 → three 123 chows, not three pungs).
 */
function extractAllMelds(tiles) {
  if (tiles.length === 0) return [[]];
  if (tiles.length % 3 !== 0) return [];
  const c = counts(tiles);
  const first = Object.keys(c).sort()[0];
  const results = [];

  if (c[first] >= 3) {
    const rest = removeN(tiles, first, 3);
    for (const nested of extractAllMelds(rest)) {
      results.push([{ type: "pong", tiles: [first, first, first], tile: first }, ...nested]);
    }
  }

  if (isSuitTile(first)) {
    const suit = suitOf(first);
    const r = rankOf(first);
    if (r <= 7) {
      const a = `${suit}${r}`;
      const b = `${suit}${r + 1}`;
      const d = `${suit}${r + 2}`;
      if ((c[a] || 0) >= 1 && (c[b] || 0) >= 1 && (c[d] || 0) >= 1) {
        let rest = removeN(tiles, a, 1);
        rest = removeN(rest, b, 1);
        rest = removeN(rest, d, 1);
        if (rest) {
          for (const nested of extractAllMelds(rest)) {
            results.push([{ type: "chow", tiles: [a, b, d], tile: a }, ...nested]);
          }
        }
      }
    }
  }

  return results;
}

/** First successful partition (compat); prefers exploring all via scoreHand. */
function extractMelds(tiles) {
  const all = extractAllMelds(tiles);
  return all.length ? all[0] : null;
}

/** Every valid pair + meld decomposition of a winning hand. */
function allDecompositions(concealed, openMelds) {
  const need = 4 - openMelds.length;
  if (concealed.length !== need * 3 + 2) return [];
  const open = openMeldsNormalized(openMelds);
  const out = [];
  const c = counts(concealed);
  for (const tile of Object.keys(c)) {
    if (c[tile] < 2) continue;
    const rest = removeN(concealed, tile, 2);
    if (!rest || !canFormMelds(rest)) continue;
    for (const concealedMelds of extractAllMelds(rest)) {
      out.push({
        pair: tile,
        melds: [...open, ...concealedMelds.map((m) => ({ ...m, open: false }))],
      });
    }
  }
  return out;
}

/** Decompose a winning hand (any valid split). */
function decomposeWin(concealed, openMelds) {
  const all = allDecompositions(concealed, openMelds);
  return all[0] || null;
}

function allTilesFrom(decomp) {
  const t = [decomp.pair, decomp.pair];
  for (const m of decomp.melds) t.push(...m.tiles);
  return t;
}

/** Score one fixed decomposition (does not check min faan for "raw"). */
function scoreDecomposition(decomp, opts) {
  const { how, seat, round, lastTile = false, openMelds } = opts;
  const items = [];
  const melds = decomp.melds;
  const triplets = melds.filter((m) => m.type === "pong" || m.type === "kong");
  const chows = melds.filter((m) => m.type === "chow");
  const allTiles = allTilesFrom(decomp);
  const suits = new Set(allTiles.filter(isSuitTile).map(suitOf));
  const hasHonor = allTiles.some(isHonor);
  const onlyHonors = allTiles.every(isHonor);
  const concealedHand = openMelds.length === 0;

  if (chows.length === 4) {
    items.push({ zh: "平胡", name: "All chows", faan: 1 });
  }
  if (triplets.length === 4) {
    items.push({ zh: "對對胡", name: "All triplets", faan: 3 });
  }
  if (onlyHonors) {
    items.push({ zh: "字一色", name: "All honors", faan: 10 });
  } else if (suits.size === 1 && hasHonor) {
    items.push({ zh: "混一色", name: "Half flush", faan: 3 });
  } else if (suits.size === 1 && !hasHonor) {
    items.push({ zh: "清一色", name: "Full flush", faan: 7 });
  }

  const seatWind = SEAT_WIND[seat];
  const roundWind = SEAT_WIND[(Math.max(1, round) - 1) % 4];
  for (const m of triplets) {
    const t = m.tile;
    if (t === "red") items.push({ zh: "紅中", name: "Red dragon", faan: 1 });
    if (t === "green") items.push({ zh: "發財", name: "Green dragon", faan: 1 });
    if (t === "white") items.push({ zh: "白板", name: "White dragon", faan: 1 });
    if (t === seatWind) items.push({ zh: "門風", name: "Seat wind", faan: 1 });
    if (t === roundWind) {
      // Seat wind already counted; still add round wind (double wind = 2).
      items.push({ zh: "圈風", name: "Round wind", faan: 1 });
    }
  }

  const dragonTriplets = triplets.filter((m) => DRAGONS.includes(m.tile));
  if (dragonTriplets.length === 3) {
    items.push({ zh: "大三元", name: "Great dragons", faan: 5 });
  } else if (dragonTriplets.length === 2 && DRAGONS.includes(decomp.pair)) {
    items.push({ zh: "小三元", name: "Small dragons", faan: 3 });
  }

  const windTriplets = triplets.filter((m) => WINDS.includes(m.tile));
  if (windTriplets.length === 4) {
    items.push({ zh: "大四喜", name: "Great winds", faan: 13 });
  } else if (windTriplets.length === 3 && WINDS.includes(decomp.pair)) {
    items.push({ zh: "小四喜", name: "Small winds", faan: 6 });
  }

  if (melds.filter((m) => m.type === "kong").length === 4) {
    items.push({ zh: "十八羅漢", name: "All kongs", faan: 13 });
  }

  if (how === "self") {
    items.push({ zh: "自摸", name: "Self-draw", faan: 1 });
  }
  if (concealedHand) {
    items.push({ zh: "門前清", name: "Concealed hand", faan: 1 });
  }
  if (lastTile) {
    items.push({ zh: "海底撈月", name: "Last tile", faan: 1 });
  }

  let faan = items.reduce((s, i) => s + i.faan, 0);
  faan = Math.min(FAAN_CAP, faan);
  return { faan, items, decomp, how };
}

/**
 * @param {object} opts
 * @param {string[]} opts.concealed - hand including winning tile
 * @param {object[]} opts.openMelds
 * @param {'self'|'discard'} opts.how
 * @param {number} opts.seat - winner seat 0-3
 * @param {number} opts.round - 1-4 → prevailing wind
 * @param {boolean} [opts.lastTile]
 */
function scoreHand(opts) {
  const { concealed, openMelds, how, seat, round, lastTile = false } = opts;
  const decomps = allDecompositions(concealed, openMelds || []);
  if (!decomps.length) return { ok: false, error: "Not a winning hand", faan: 0 };

  let best = null;
  for (const decomp of decomps) {
    const raw = scoreDecomposition(decomp, { how, seat, round, lastTile, openMelds: openMelds || [] });
    if (
      !best ||
      raw.faan > best.faan ||
      (raw.faan === best.faan && raw.items.some((i) => i.zh === "平胡") && !best.items.some((i) => i.zh === "平胡"))
    ) {
      best = raw;
    }
  }

  // No minimum faan — 平胡 / 鸡胡 always allowed once the hand is complete.
  const items =
    best.items.length > 0
      ? best.items
      : [{ zh: "鸡胡", name: "Chicken", faan: 0 }];

  return {
    ok: true,
    faan: best.faan,
    base: faanToPoints(best.faan),
    items,
    decomp: best.decomp,
    how,
  };
}

/**
 * Apply HK payment.
 * Discard: discarder pays all (base).
 * Self-draw: winner gets 1.5×base; each of 3 losers pays base/2.
 */
function settlePayments(score, winnerSeat, discarderSeat) {
  const deltas = [0, 0, 0, 0];
  if (!score.ok) return deltas;

  if (score.how === "self") {
    const total = Math.round(score.base * 1.5);
    const each = total / 3;
    for (let s = 0; s < 4; s++) {
      if (s === winnerSeat) deltas[s] = total;
      else deltas[s] = -each;
    }
  } else {
    const pay = score.base;
    deltas[winnerSeat] = pay;
    deltas[discarderSeat] = -pay;
  }
  return deltas;
}

function canWinScored(concealed, openMelds, how, seat, round) {
  const result = scoreHand({ concealed, openMelds, how, seat, round });
  return result.ok;
}

module.exports = {
  MIN_FAAN,
  FAAN_CAP,
  faanToPoints,
  scoreHand,
  settlePayments,
  canWinScored,
  decomposeWin,
  extractMelds,
  extractAllMelds,
  allDecompositions,
  SEAT_WIND,
};

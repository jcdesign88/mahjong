/** Hand structure checks: win, pong, kong, chi. */

const { counts, removeN, isSuitTile, suitOf, rankOf } = require("./tiles");

/** True if tiles can be partitioned into melds (3 each) with leftover empty. */
function canFormMelds(tiles) {
  if (tiles.length === 0) return true;
  if (tiles.length % 3 !== 0) return false;
  const c = counts(tiles);
  const keys = Object.keys(c).sort();

  const first = keys[0];
  // try pung
  if (c[first] >= 3) {
    if (canFormMelds(removeN(tiles, first, 3))) return true;
  }
  // try chow
  if (isSuitTile(first)) {
    const suit = suitOf(first);
    const r = rankOf(first);
    if (r <= 7) {
      const a = `${suit}${r}`;
      const b = `${suit}${r + 1}`;
      const d = `${suit}${r + 2}`;
      if ((c[a] || 0) >= 1 && (c[b] || 0) >= 1 && (c[d] || 0) >= 1) {
        let next = removeN(tiles, a, 1);
        next = removeN(next, b, 1);
        next = removeN(next, d, 1);
        if (next && canFormMelds(next)) return true;
      }
    }
  }
  return false;
}

/** Standard win: 4 melds + 1 pair (concealed + open melds counted). */
function isWinningHand(concealed, openMeldCount) {
  const needMelds = 4 - openMeldCount;
  if (concealed.length !== needMelds * 3 + 2) return false;
  const c = counts(concealed);
  for (const tile of Object.keys(c)) {
    if (c[tile] < 2) continue;
    const rest = removeN(concealed, tile, 2);
    if (rest && canFormMelds(rest)) return true;
  }
  return false;
}

function canWinWith(concealed, tile, openMeldCount) {
  return isWinningHand([...concealed, tile], openMeldCount);
}

function canPong(concealed, tile) {
  return (counts(concealed)[tile] || 0) >= 2;
}

function canKong(concealed, tile) {
  return (counts(concealed)[tile] || 0) >= 3;
}

function canClosedKong(concealed) {
  const c = counts(concealed);
  return Object.keys(c).filter((t) => c[t] >= 4);
}

/** Chi only from previous player; returns possible chow patterns as tile triples. */
function chiOptions(concealed, tile) {
  if (!isSuitTile(tile)) return [];
  const suit = suitOf(tile);
  const r = rankOf(tile);
  const c = counts(concealed);
  const options = [];

  const tryPattern = (ranks) => {
    const needed = ranks.filter((x) => x !== r);
    if (needed.every((x) => (c[`${suit}${x}`] || 0) >= 1)) {
      options.push(ranks.map((x) => `${suit}${x}`));
    }
  };

  if (r >= 3) tryPattern([r - 2, r - 1, r]);
  if (r >= 2 && r <= 8) tryPattern([r - 1, r, r + 1]);
  if (r <= 7) tryPattern([r, r + 1, r + 2]);

  // unique by sorted join
  const seen = new Set();
  return options.filter((opt) => {
    const key = [...opt].sort().join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canChi(concealed, tile) {
  return chiOptions(concealed, tile).length > 0;
}

module.exports = {
  canFormMelds,
  isWinningHand,
  canWinWith,
  canPong,
  canKong,
  canClosedKong,
  chiOptions,
  canChi,
};

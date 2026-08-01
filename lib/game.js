/**
 * Mahjong table — 4 players, individual scores (Hong Kong rules).
 */

const { createWall, sortTiles, removeOne, removeN, counts, SHORT } = require("./tiles");
const tileName = (t) => SHORT[t] || t;
const {
  isWinningHand,
  canWinWith,
  canPong,
  canKong,
  canClosedKong,
  chiOptions,
  canChi,
} = require("./hand");
const { scoreHand, settlePayments, SEAT_WIND, MIN_FAAN } = require("./score");

const SEAT_NAMES = ["East", "South", "West", "North"];
const CLAIM_MS = 10000;

function emptyPlayer(seat) {
  return {
    seat,
    name: null,
    id: null,
    isBot: false,
    ready: false,
    hand: [],
    melds: [], // { type: 'pong'|'kong'|'chi', tiles: [], from }
    discards: [],
    score: 0,
  };
}

class Game {
  constructor(roomCode, onUpdate = () => {}) {
    this.roomCode = roomCode;
    this.onUpdate = onUpdate;
    this.players = [0, 1, 2, 3].map(emptyPlayer);
    this.phase = "lobby"; // lobby | playing | claim | round_end | match_end
    this.wall = [];
    this.turn = 0;
    this.dealer = 0;
    this.round = 0;
    this.lastDiscard = null;
    this.lastDiscarder = null;
    this.claimDeadline = null;
    this.pendingClaims = []; // { seat, action, tiles? }
    this.claimTimer = null;
    this.winner = null;
    this.winInfo = null;
    this.log = [];
  }

  /** Score a potential win for this seat. */
  scoreWin(seat, concealed, how) {
    return scoreHand({
      concealed,
      openMelds: this.players[seat].melds,
      how,
      seat,
      round: Math.max(1, this.round),
      lastTile: this.wall.length === 0,
    });
  }

  /** Can win? Any complete hand — no minimum faan. */
  canHu(seat, concealed, how) {
    return this.scoreWin(seat, concealed, how).ok;
  }

  emit() {
    try {
      this.onUpdate();
    } catch (_) {
      /* ignore listener errors */
    }
  }

  addLog(msg) {
    // Unique timestamps so rapid bot discards each get audio
    const t = Math.max(Date.now(), (this.log[this.log.length - 1]?.t || 0) + 1);
    this.log.push({ t, msg });
    if (this.log.length > 40) this.log.shift();
  }

  seatOf(socketId) {
    return this.players.findIndex((p) => p.id === socketId);
  }

  occupiedCount() {
    return this.players.filter((p) => p.id || p.isBot).length;
  }

  humanCount() {
    return this.players.filter((p) => p.id && !p.isBot).length;
  }

  join(socketId, name) {
    if (this.phase !== "lobby") return { ok: false, error: "Game already started" };
    const existing = this.seatOf(socketId);
    if (existing >= 0) {
      this.players[existing].name = name.slice(0, 16);
      return { ok: true, seat: existing };
    }
    const free = this.players.findIndex((p) => !p.id && !p.isBot);
    if (free < 0) return { ok: false, error: "Room is full" };
    this.players[free].id = socketId;
    this.players[free].name = name.slice(0, 16) || `Player ${free + 1}`;
    this.players[free].isBot = false;
    this.players[free].ready = false;
    this.addLog(`${this.players[free].name} joined as ${SEAT_NAMES[free]}`);
    return { ok: true, seat: free };
  }

  leave(socketId) {
    const seat = this.seatOf(socketId);
    if (seat < 0) return;
    const name = this.players[seat].name;
    if (this.phase === "lobby") {
      this.players[seat] = emptyPlayer(seat);
      this.addLog(`${name} left`);
    } else {
      // become bot mid-game
      this.players[seat].id = null;
      this.players[seat].isBot = true;
      this.players[seat].name = (name || SEAT_NAMES[seat]) + " (bot)";
      this.addLog(`${name} disconnected — bot takes over`);
    }
  }

  setReady(socketId, ready) {
    const seat = this.seatOf(socketId);
    if (seat < 0 || this.phase !== "lobby") return false;
    this.players[seat].ready = !!ready;
    return true;
  }

  fillBots() {
    if (this.phase !== "lobby") return false;
    for (const p of this.players) {
      if (!p.id && !p.isBot) {
        p.isBot = true;
        p.name = `Bot ${SEAT_NAMES[p.seat]}`;
        p.ready = true;
      }
    }
    return true;
  }

  canStart() {
    if (this.phase !== "lobby") return false;
    if (this.occupiedCount() < 4) return false;
    return this.players.every((p) => p.isBot || (p.id && p.ready));
  }

  start() {
    if (!this.canStart()) return { ok: false, error: "Need 4 ready players (or fill bots)" };
    this.round = 1;
    this.startRound();
    return { ok: true };
  }

  startRound() {
    this.clearClaimTimer();
    this.wall = createWall();
    this.winner = null;
    this.winInfo = null;
    this.lastDiscard = null;
    this.lastDiscarder = null;
    this.pendingClaims = [];
    this.drawPending = false;
    this.phase = "playing";
    this.turn = this.dealer;

    for (const p of this.players) {
      p.hand = [];
      p.melds = [];
      p.discards = [];
    }

    // deal 13 each
    for (let i = 0; i < 13; i++) {
      for (let s = 0; s < 4; s++) {
        this.players[s].hand.push(this.wall.pop());
      }
    }
    // dealer draws 14th
    this.players[this.dealer].hand.push(this.wall.pop());
    for (const p of this.players) p.hand = sortTiles(p.hand);

    this.addLog(`Round ${this.round} — ${SEAT_NAMES[this.dealer]} deals`);
    this.maybeBotAct();
  }

  clearClaimTimer() {
    if (this.claimTimer) {
      clearTimeout(this.claimTimer);
      this.claimTimer = null;
    }
    this.claimDeadline = null;
  }

  current() {
    return this.players[this.turn];
  }

  drawTile(seat) {
    if (this.wall.length === 0) {
      this.endRoundDraw();
      return null;
    }
    const tile = this.wall.pop();
    this.players[seat].hand.push(tile);
    this.players[seat].hand = sortTiles(this.players[seat].hand);
    return tile;
  }

  discard(socketId, tile) {
    const seat = this.seatOf(socketId);
    if (seat < 0) return { ok: false, error: "Not seated" };
    if (this.phase !== "playing") return { ok: false, error: "Not your phase" };
    if (seat !== this.turn) return { ok: false, error: "Not your turn" };
    const p = this.players[seat];
    if (!p.hand.includes(tile)) return { ok: false, error: "Tile not in hand" };

    // Discardable hand length is always 2 mod 3 (14, 11, 8, …).
    if (p.hand.length % 3 !== 2) {
      return { ok: false, error: "You must draw before discarding" };
    }

    p.hand = removeOne(p.hand, tile);
    p.hand = sortTiles(p.hand);
    p.discards.push(tile);
    this.lastDiscard = tile;
    this.lastDiscarder = seat;
    this.addLog(`${p.name} discarded ${tileName(tile)}`);
    this.openClaimWindow(seat, tile);
    return { ok: true };
  }

  /** Open claim window after a discard; always notify clients first when humans can act. */
  openClaimWindow(discarderSeat, tile) {
    this.clearClaimTimer();
    this.pendingClaims = [];
    this.phase = "claim";
    this.claimDeadline = Date.now() + CLAIM_MS;

    // Bot intentions (independent checks — hu does not hide pong/kong options for humans)
    for (let s = 0; s < 4; s++) {
      if (s === discarderSeat) continue;
      const op = this.players[s];
      if (!op.isBot) continue;
      if (this.canHu(s, [...op.hand, tile], "discard")) {
        this.pendingClaims.push({ seat: s, action: "hu" });
      } else if (canKong(op.hand, tile) && Math.random() < 0.7) {
        this.pendingClaims.push({ seat: s, action: "kong" });
      } else if (canPong(op.hand, tile) && Math.random() < 0.55) {
        this.pendingClaims.push({ seat: s, action: "pong" });
      } else if (s === (discarderSeat + 1) % 4 && canChi(op.hand, tile) && Math.random() < 0.35) {
        const opts = chiOptions(op.hand, tile);
        if (opts[0]) this.pendingClaims.push({ seat: s, action: "chi", tiles: opts[0] });
      }
    }

    const humansCanClaim = this.humansWhoCanClaim().length > 0;

    // Push claim UI to clients before any resolve
    this.emit();

    if (!humansCanClaim) {
      // Short pause so the discard is visible, then resolve bot claims / next draw
      this.claimTimer = setTimeout(() => {
        this.resolveClaims();
        this.emit();
      }, this.pendingClaims.length ? 500 : 350);
    } else {
      this.claimTimer = setTimeout(() => {
        this.resolveClaims();
        this.emit();
      }, CLAIM_MS);
    }
  }

  humansWhoCanClaim() {
    if (this.phase !== "claim" || this.lastDiscarder == null) return [];
    return [0, 1, 2, 3].filter((s) => {
      if (s === this.lastDiscarder) return false;
      const op = this.players[s];
      if (!op.id || op.isBot) return false;
      return this.availableClaimsFor(s).length > 0;
    });
  }

  /**
   * All legal claim actions for one seat on the current discard.
   * Independent checks — if a player can both 碰 and 吃, BOTH are returned.
   * Priority 胡>槓>碰>吃 is only for pickWinningClaim (multi-seat conflicts).
   */
  availableClaimsFor(seat) {
    if (this.phase !== "claim" || this.lastDiscard == null) return [];
    if (seat === this.lastDiscarder) return [];
    const op = this.players[seat];
    const tile = this.lastDiscard;
    const acts = [];
    if (canWinWith(op.hand, tile, op.melds.length)) {
      acts.push({ action: "hu", legal: true });
    }
    if (canKong(op.hand, tile)) acts.push({ action: "kong" });
    if (canPong(op.hand, tile)) acts.push({ action: "pong" });
    // Chi only from the player after the discarder — still listed alongside 碰 when both apply.
    if (seat === (this.lastDiscarder + 1) % 4) {
      const opts = chiOptions(op.hand, tile);
      for (const pattern of opts) acts.push({ action: "chi", tiles: pattern });
    }
    return acts;
  }

  claim(socketId, action, tiles) {
    const seat = this.seatOf(socketId);
    if (seat < 0) return { ok: false, error: "Not seated" };
    if (this.phase !== "claim") return { ok: false, error: "No claim window" };
    if (action === "pass") {
      this.pendingClaims = this.pendingClaims.filter((c) => c.seat !== seat);
      this.pendingClaims.push({ seat, action: "pass" });
      this.maybeEarlyResolve();
      return { ok: true };
    }
    const allowed = this.availableClaimsFor(seat);
    if (!allowed.some((a) => a.action === action)) {
      return { ok: false, error: "Invalid claim" };
    }
    if (action === "chi") {
      const ok = allowed.some(
        (a) => a.action === "chi" && a.tiles.slice().sort().join() === [...(tiles || [])].sort().join()
      );
      if (!ok) return { ok: false, error: "Invalid claim" };
    }
    const match = allowed.find(
      (a) =>
        a.action === action &&
        (action !== "chi" ||
          (a.tiles && tiles && a.tiles.slice().sort().join() === [...tiles].sort().join()))
    );
    this.pendingClaims = this.pendingClaims.filter((c) => c.seat !== seat);
    this.pendingClaims.push({ seat, action, tiles: tiles || match?.tiles });
    this.maybeEarlyResolve();
    return { ok: true };
  }

  /** Humans who still need to answer this claim window (not yet passed/claimed). */
  humansPendingResponse() {
    if (this.phase !== "claim" || this.lastDiscarder == null) return [];
    return [0, 1, 2, 3].filter((s) => {
      if (s === this.lastDiscarder) return false;
      const p = this.players[s];
      if (!p?.id || p.isBot) return false;
      if (this.pendingClaims.some((c) => c.seat === s)) return false; // already answered
      return this.availableClaimsFor(s).length > 0;
    });
  }

  maybeEarlyResolve() {
    // Wait for every human who can still 吃/碰/槓/胡 to answer.
    // Then resolve — pickWinningClaim enforces 胡 > 槓 > 碰 > 吃.
    if (this.humansPendingResponse().length > 0) return;
    this.resolveClaims();
    this.emit();
  }

  /**
   * Claim priority (HK / Chinese mahjong):
   * 胡 > 槓 > 碰 > 吃
   * Same rank → nearest player after the discarder (turn order).
   */
  pickWinningClaim(claims) {
    const rank = { hu: 4, kong: 3, pong: 2, chi: 1 };
    let best = null;
    for (const c of claims) {
      if (c.action === "pass" || !rank[c.action]) continue;
      if (!best) {
        best = c;
        continue;
      }
      const r = rank[c.action];
      const br = rank[best.action];
      if (r > br) {
        best = c;
        continue;
      }
      if (r === br) {
        const d = (c.seat - this.lastDiscarder + 4) % 4 || 4;
        const bd = (best.seat - this.lastDiscarder + 4) % 4 || 4;
        if (d < bd) best = c;
      }
    }
    return best;
  }

  resolveClaims() {
    if (this.phase !== "claim") return;
    this.clearClaimTimer();

    const claims = this.pendingClaims.filter((c) => c.action !== "pass");
    const win = this.pickWinningClaim(claims);

    if (!win) {
      // next player draws
      this.phase = "playing";
      this.turn = (this.lastDiscarder + 1) % 4;
      this.drawTile(this.turn);
      this.addLog(`${this.players[this.turn].name} 摸牌`);
      this.maybeBotAct();
      return;
    }

    // 胡 always wins over 槓/碰/吃
    if (win.action === "hu") {
      this.completeWin(win.seat, "discard", this.lastDiscard);
      return;
    }

    const discarder = this.players[this.lastDiscarder];
    discarder.discards.pop();

    const p = this.players[win.seat];
    const tile = this.lastDiscard;

    if (win.action === "pong" || win.action === "kong") {
      const n = win.action === "kong" ? 3 : 2;
      p.hand = removeN(p.hand, tile, n);
      const tiles = Array(n + 1).fill(tile);
      p.melds.push({ type: win.action, tiles, from: this.lastDiscarder });
      p.hand = sortTiles(p.hand);
      this.addLog(`${p.name} ${win.action === "kong" ? "槓" : "碰"}!`);
      this.phase = "playing";
      this.turn = win.seat;
      if (win.action === "kong") {
        this.drawTile(win.seat);
      }
      this.lastDiscard = null;
      this.maybeBotAct();
      return;
    }

    if (win.action === "chi") {
      const pattern = win.tiles;
      for (const t of pattern) {
        if (t === tile) continue;
        p.hand = removeOne(p.hand, t);
      }
      p.melds.push({ type: "chi", tiles: pattern, from: this.lastDiscarder });
      p.hand = sortTiles(p.hand);
      this.addLog(`${p.name} 吃!`);
      this.phase = "playing";
      this.turn = win.seat;
      this.lastDiscard = null;
      this.maybeBotAct();
    }
  }

  selfWin(socketId) {
    const seat = this.seatOf(socketId);
    if (seat < 0 || this.phase !== "playing" || seat !== this.turn) {
      return { ok: false, error: "Cannot win now" };
    }
    const p = this.players[seat];
    if (!isWinningHand(p.hand, p.melds.length)) {
      return { ok: false, error: "Hand is not a winning hand" };
    }
    this.completeWin(seat, "self", null);
    return { ok: true };
  }

  declareKong(socketId, tile) {
    const seat = this.seatOf(socketId);
    if (seat < 0 || this.phase !== "playing" || seat !== this.turn) {
      return { ok: false, error: "Not your turn" };
    }
    const p = this.players[seat];
    // closed kong
    if ((counts(p.hand)[tile] || 0) >= 4) {
      p.hand = removeN(p.hand, tile, 4);
      p.melds.push({ type: "kong", tiles: [tile, tile, tile, tile], from: seat, concealed: true });
      p.hand = sortTiles(p.hand);
      this.drawTile(seat);
      this.addLog(`${p.name} concealed kong`);
      this.maybeBotAct();
      return { ok: true };
    }
    // promote pong to kong
    const meld = p.melds.find((m) => m.type === "pong" && m.tiles[0] === tile);
    if (meld && p.hand.includes(tile)) {
      p.hand = removeOne(p.hand, tile);
      meld.type = "kong";
      meld.tiles = [tile, tile, tile, tile];
      p.hand = sortTiles(p.hand);
      this.drawTile(seat);
      this.addLog(`${p.name} promoted kong`);
      this.maybeBotAct();
      return { ok: true };
    }
    return { ok: false, error: "Cannot kong that tile" };
  }

  completeWin(seat, how, tile) {
    this.clearClaimTimer();
    const p = this.players[seat];
    if (how === "discard" && tile) {
      p.hand = sortTiles([...p.hand, tile]);
      this.players[this.lastDiscarder].discards.pop();
    }
    this.winner = seat;
    this.phase = "round_end";

    const scored = this.scoreWin(seat, p.hand, how);

    const deltas = settlePayments(scored, seat, this.lastDiscarder);
    for (let i = 0; i < 4; i++) this.players[i].score += deltas[i];

    this.winInfo = {
      seat,
      name: p.name,
      how,
      tile,
      faan: scored.faan || 0,
      base: scored.base || 0,
      points: deltas[seat],
      items: scored.items || [],
      deltas,
      hand: [...p.hand],
      melds: p.melds,
    };
    const itemStr = (scored.items || []).map((i) => i.zh).join("·") || "—";
    this.addLog(
      `${p.name} wins! ${scored.faan || 0}番 (+${deltas[seat]}) ${how === "self" ? "自摸" : "食糊"} [${itemStr}]`
    );
  }

  endRoundDraw() {
    this.clearClaimTimer();
    this.phase = "round_end";
    this.winner = null;
    this.winInfo = { draw: true };
    this.addLog("Wall empty — draw");
  }

  nextRound() {
    if (this.phase !== "round_end") return { ok: false };
    if (this.round >= 4) {
      this.phase = "match_end";
      return { ok: true, matchEnd: true };
    }
    this.round += 1;
    this.dealer = (this.dealer + 1) % 4;
    this.startRound();
    return { ok: true };
  }

  rematch() {
    for (const p of this.players) {
      p.score = 0;
      p.ready = p.isBot;
      p.hand = [];
      p.melds = [];
      p.discards = [];
    }
    this.phase = "lobby";
    this.round = 0;
    this.winner = null;
    this.winInfo = null;
    this.clearClaimTimer();
    return { ok: true };
  }

  /** Bot AI: discard orphans; claim/win opportunistically. */
  maybeBotAct() {
    if (this.phase === "claim") return;
    if (this.phase !== "playing") return;
    const seat = this.turn;
    const p = this.players[seat];
    if (!p.isBot) return;

    setTimeout(() => {
      if (this.phase !== "playing" || this.turn !== seat) return;
      if (this.canHu(seat, p.hand, "self")) {
        this.completeWin(seat, "self", null);
        this.emit();
        return;
      }
      const kongs = canClosedKong(p.hand);
      if (kongs.length && Math.random() < 0.8) {
        const tile = kongs[0];
        p.hand = removeN(p.hand, tile, 4);
        p.melds.push({ type: "kong", tiles: [tile, tile, tile, tile], from: seat, concealed: true });
        p.hand = sortTiles(p.hand);
        this.drawTile(seat);
        this.addLog(`${p.name} concealed kong`);
        this.emit();
        this.maybeBotAct();
        return;
      }
      const tile = pickDiscard(p.hand);
      p.hand = removeOne(p.hand, tile);
      p.hand = sortTiles(p.hand);
      p.discards.push(tile);
      this.lastDiscard = tile;
      this.lastDiscarder = seat;
      this.addLog(`${p.name} discarded ${tileName(tile)}`);
      this.openClaimWindow(seat, tile);
    }, 600 + Math.random() * 700);
  }

  /** Public view for a socket — hides other hands. */
  viewFor(socketId) {
    const mySeat = this.seatOf(socketId);
    return {
      roomCode: this.roomCode,
      phase: this.phase,
      round: this.round,
      turn: this.turn,
      dealer: this.dealer,
      wallCount: this.wall.length,
      lastDiscard: this.lastDiscard,
      lastDiscarder: this.lastDiscarder,
      claimDeadline: this.claimDeadline,
      winner: this.winner,
      winInfo: this.winInfo,
      mySeat,
      roundWind: SEAT_WIND[(Math.max(1, this.round) - 1) % 4],
      minFaan: MIN_FAAN,
      scores: this.players.map((p) => ({ seat: p.seat, name: p.name, score: p.score })),
      claims: mySeat >= 0 && this.phase === "claim" ? this.availableClaimsFor(mySeat) : [],
      claimMs: CLAIM_MS,
      canSelfWin:
        mySeat >= 0 &&
        this.phase === "playing" &&
        mySeat === this.turn &&
        isWinningHand(this.players[mySeat].hand, this.players[mySeat].melds.length),
      selfWinLegal: true,
      selfWinError: null,
      closedKongs:
        mySeat >= 0 && this.phase === "playing" && mySeat === this.turn
          ? canClosedKong(this.players[mySeat].hand)
          : [],
      log: this.log.slice(-12),
      seats: this.players.map((p, i) => ({
        seat: i,
        name: p.name,
        isBot: p.isBot,
        ready: p.ready,
        connected: !!p.id,
        seatName: SEAT_NAMES[i],
        seatWind: SEAT_WIND[i],
        score: p.score,
        handCount: p.hand.length,
        hand: i === mySeat ? p.hand : null,
        melds: p.melds,
        discards: p.discards,
        isTurn: this.phase === "playing" && this.turn === i,
      })),
    };
  }
}

function pickDiscard(hand) {
  const c = counts(hand);
  // prefer singles of honors
  const singles = Object.keys(c).filter((t) => c[t] === 1);
  const honorSingles = singles.filter((t) => !/^man[1-9]$|^pin[1-9]$|^sou[1-9]$/.test(t));
  if (honorSingles.length) return honorSingles[Math.floor(Math.random() * honorSingles.length)];
  if (singles.length) return singles[Math.floor(Math.random() * singles.length)];
  return hand[Math.floor(Math.random() * hand.length)];
}

module.exports = { Game, SEAT_NAMES, CLAIM_MS };

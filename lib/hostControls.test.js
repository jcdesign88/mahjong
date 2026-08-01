/** Quick checks for host stop / mid-game kick / approve takeover — run: node lib/hostControls.test.js */
const { Game } = require("./game");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

function makeRoom() {
  const g = new Game("TEST");
  const host = g.joinAsHost("host1", "Host");
  assert(host.ok, "host join");
  g.fillBots("host1");
  for (const p of g.players) {
    if (p.id === "host1") p.ready = true;
  }
  const start = g.start("host1");
  assert(start.ok, "start: " + (start.error || ""));
  assert(g.phase === "playing", "phase playing");
  return g;
}

// 1) Host stop → lobby, humans/bots kept, hands cleared
{
  const g = makeRoom();
  const hostHandBefore = g.players[0].hand.length;
  assert(hostHandBefore >= 13, "host has hand");
  const botNames = g.players.filter((p) => p.isBot).map((p) => p.name);
  assert(botNames.length === 3, "3 bots");

  const stop = g.stopGame("host1");
  assert(stop.ok, "stop ok");
  assert(g.phase === "lobby", "back to lobby");
  assert(g.players[0].id === "host1", "host still seated");
  assert(g.players[0].hand.length === 0, "hands cleared");
  assert(g.wall.length === 0, "wall cleared");
  assert(g.winner == null, "no winner");
  assert(g.players.filter((p) => p.isBot).length === 3, "bots kept");
  assert(g.log.some((l) => l.msg.includes("房主结束了对局")), "log message");
  assert(g.players.every((p) => !p.ready || p.isBot), "humans not ready");
}

// Non-host cannot stop
{
  const g = makeRoom();
  // Seat a second human by swapping a bot
  g.players[1].id = "p2";
  g.players[1].isBot = false;
  g.players[1].name = "P2";
  const bad = g.stopGame("p2");
  assert(!bad.ok, "non-host stop denied");
}

// 2) Kick bot mid-game → vacant bot seat keeps tiles
{
  const g = makeRoom();
  const seat = 2;
  const hand = [...g.players[seat].hand];
  const melds = g.players[seat].melds;
  assert(g.players[seat].isBot, "seat is bot");

  const kick = g.kick("host1", seat);
  assert(kick.ok, "kick ok");
  assert(g.players[seat].isBot, "still bot for AI");
  assert(g.players[seat].id == null, "no owner");
  assert(g.players[seat].name === "空位", "vacant name");
  assert(g.players[seat].hand.join() === hand.join(), "hand preserved");
  assert(g.players[seat].melds === melds, "melds preserved");
}

// 3) Mid-game requestJoin + approveJoin takes over bot seat hand
{
  const g = makeRoom();
  const seat = 1;
  const hand = [...g.players[seat].hand];
  const score = g.players[seat].score;

  const req = g.requestJoin("friend1", "Friend");
  assert(req.ok && req.pending, "pending mid-game");
  assert(g.pendingJoins.length === 1, "queued");

  const ap = g.approveJoin("host1", "friend1");
  assert(ap.ok, "approve: " + (ap.error || ""));
  assert(ap.seat === seat, "took first bot seat");
  assert(g.players[seat].id === "friend1", "seated");
  assert(!g.players[seat].isBot, "not bot");
  assert(g.players[seat].hand.join() === hand.join(), "inherited hand");
  assert(g.players[seat].score === score, "inherited score");
  assert(g.players[seat].rejoinToken, "new rejoin token");
}

// Kick then approve into vacated seat (only one bot left)
{
  const g = makeRoom();
  for (const s of [1, 2]) {
    g.players[s].id = "h" + s;
    g.players[s].isBot = false;
    g.players[s].name = "H" + s;
  }
  const seat = 3;
  const hand = [...g.players[seat].hand];
  g.kick("host1", seat);
  g.requestJoin("friend2", "Friend2");
  const ap = g.approveJoin("host1", "friend2");
  assert(ap.ok && ap.seat === seat, "approve into kicked seat");
  assert(g.players[seat].hand.join() === hand.join(), "tiles still there");
  assert(g.players[seat].id === "friend2", "friend seated");
}

// resetByHost alias
{
  const g = makeRoom();
  assert(g.resetByHost("host1").ok, "reset alias");
  assert(g.phase === "lobby", "lobby after reset");
}

console.log("hostControls tests passed");

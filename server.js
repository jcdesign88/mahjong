const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { Game } = require("./lib/game");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false } });

const PORT = process.env.PORT || 3847;
const rooms = new Map();
/** Delay before deleting an empty lobby (allows accidental disconnect rejoin). */
const EMPTY_LOBBY_MS = 3 * 60 * 1000;

app.use(express.static(path.join(__dirname, "public")));

function makeCode() {
  const code = String(Math.floor(Math.random() * 90000) + 10000);
  if (rooms.has(code)) return makeCode();
  return code;
}

function broadcast(roomCode) {
  const game = rooms.get(roomCode);
  if (!game) return;
  for (const sock of io.sockets.adapter.rooms.get(roomCode) || []) {
    const s = io.sockets.sockets.get(sock);
    if (s) s.emit("state", game.viewFor(s.id));
  }
}

function clearEmptyTimer(game) {
  if (game._emptyTimer) {
    clearTimeout(game._emptyTimer);
    game._emptyTimer = null;
  }
}

function scheduleEmptyCleanup(roomCode, game) {
  clearEmptyTimer(game);
  game._emptyTimer = setTimeout(() => {
    const g = rooms.get(roomCode);
    if (!g || g !== game) return;
    if (g.humanCount() === 0 && g.phase === "lobby") {
      g.clearClaimTimer();
      rooms.delete(roomCode);
    }
  }, EMPTY_LOBBY_MS);
}

function createGame(code) {
  const game = new Game(code, () => broadcast(code));
  rooms.set(code, game);
  return game;
}

function seatPlayer(socket, game, result, cb) {
  const roomCode = game.roomCode;
  socket.join(roomCode);
  clearEmptyTimer(game);
  cb?.({
    ok: true,
    roomCode,
    seat: result.seat,
    rejoinToken: result.rejoinToken,
    host: !!result.host,
    rejoined: !!result.rejoined,
  });
  broadcast(roomCode);
  return roomCode;
}

function roomOf(socket) {
  return socket.data.roomCode || null;
}

function setRoom(socket, code) {
  socket.data.roomCode = code || null;
}

io.on("connection", (socket) => {
  setRoom(socket, null);

  socket.on("create", ({ name }, cb) => {
    const code = makeCode();
    const game = createGame(code);
    const result = game.joinAsHost(socket.id, name || "Host");
    if (!result.ok) return cb?.(result);
    setRoom(socket, seatPlayer(socket, game, result, cb));
  });

  socket.on("join", ({ roomCode: code, name, rejoinToken }, cb) => {
    const game = rooms.get(String(code || "").toUpperCase());
    if (!game) return cb?.({ ok: false, error: "找不到房间 — 请确认房号，或让房主重新创建" });

    const result = game.requestJoin(socket.id, name || "Player", rejoinToken);
    if (!result.ok) return cb?.(result);

    if (result.pending) {
      setRoom(socket, game.roomCode);
      socket.join(game.roomCode);
      clearEmptyTimer(game);
      cb?.({ ok: true, pending: true, roomCode: game.roomCode });
      broadcast(game.roomCode);
      return;
    }

    setRoom(socket, seatPlayer(socket, game, result, cb));
    if (result.rejoined && game.phase !== "lobby") {
      game.maybeBotAct();
    }
  });

  socket.on("approveJoin", ({ socketId: targetId }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.approveJoin(socket.id, targetId);
    cb?.(result);
    if (result.ok) {
      const target = io.sockets.sockets.get(result.socketId);
      if (target) {
        setRoom(target, game.roomCode);
        target.join(game.roomCode);
        target.emit("joinApproved", {
          roomCode: game.roomCode,
          seat: result.seat,
          rejoinToken: result.rejoinToken,
        });
      }
      broadcast(roomCode);
    }
  });

  socket.on("denyJoin", ({ socketId: targetId }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.denyJoin(socket.id, targetId);
    cb?.(result);
    if (result.ok) {
      const target = io.sockets.sockets.get(result.socketId);
      if (target) {
        target.emit("joinDenied", { reason: "房主拒绝了你的加入申请" });
        target.leave(game.roomCode);
        setRoom(target, null);
      }
      broadcast(roomCode);
    }
  });

  socket.on("kick", ({ seat }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.kick(socket.id, seat);
    cb?.(result);
    if (result.ok) {
      if (result.kickedId) {
        const target = io.sockets.sockets.get(result.kickedId);
        if (target) {
          target.emit("kicked", { reason: "房主请你离开了房间" });
          target.leave(game.roomCode);
          setRoom(target, null);
        }
      }
      broadcast(roomCode);
      if (game.phase !== "lobby") game.maybeBotAct();
    }
  });

  socket.on("stopGame", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.stopGame(socket.id);
    cb?.(result);
    if (result.ok) broadcast(roomCode);
  });

  socket.on("resetRoom", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.resetByHost(socket.id);
    cb?.(result);
    if (result.ok) broadcast(roomCode);
  });

  socket.on("ready", ({ ready }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    game.setReady(socket.id, ready);
    cb?.({ ok: true });
    broadcast(roomCode);
  });

  socket.on("setName", ({ name }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false, error: "No room" });
    const result = game.setName(socket.id, name);
    cb?.(result);
    if (result.ok) broadcast(roomCode);
  });

  socket.on("fillBots", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const ok = game.fillBots(socket.id);
    cb?.({ ok });
    broadcast(roomCode);
  });

  socket.on("start", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.start(socket.id);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("discard", ({ tile }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.discard(socket.id, tile);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("claim", ({ action, tiles }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.claim(socket.id, action, tiles);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("selfWin", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.selfWin(socket.id);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("kong", ({ tile }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.declareKong(socket.id, tile);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("nextRound", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.nextRound();
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("rematch", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.rematch();
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("pause", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.pause(socket.id);
    cb?.(result);
    broadcast(roomCode);
    game.maybeBotAct();
  });

  socket.on("resume", (_data, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.resume(socket.id);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("quickChat", ({ id }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.quickChat(socket.id, id);
    cb?.(result);
    if (result.ok && result.chat) {
      io.to(roomCode).emit("quickChat", result.chat);
      broadcast(roomCode);
    }
  });

  socket.on("chat", ({ text, voice }, cb) => {
    const roomCode = roomOf(socket);
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.chat(socket.id, text, { voice });
    cb?.(result);
    if (result.ok && result.chat) {
      io.to(roomCode).emit("quickChat", result.chat);
      broadcast(roomCode);
    }
  });

  // WebRTC voice signaling (peer-to-peer — real mic audio, not TTS)
  socket.on("voice-signal", ({ to, data }) => {
    const roomCode = roomOf(socket);
    if (!roomCode || !to || !data) return;
    const target = io.sockets.sockets.get(to);
    // Only relay within the same room (stale socket ids after rejoin are dropped)
    if (target && roomOf(target) === roomCode) {
      target.emit("voice-signal", { from: socket.id, data });
    }
  });

  socket.on("leaveRoom", (_payload, cb) => {
    const roomCode = roomOf(socket);
    if (!roomCode) return cb?.({ ok: true });
    const game = rooms.get(roomCode);
    if (!game) {
      setRoom(socket, null);
      return cb?.({ ok: true });
    }
    game.leave(socket.id, { intentional: true });
    socket.leave(roomCode);
    setRoom(socket, null);
    if (game.humanCount() === 0 && game.phase === "lobby") {
      scheduleEmptyCleanup(roomCode, game);
      broadcast(roomCode);
    } else {
      broadcast(roomCode);
      game.maybeBotAct();
    }
    cb?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const roomCode = roomOf(socket);
    if (!roomCode) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    game.leave(socket.id);
    if (game.humanCount() === 0 && game.phase === "lobby") {
      scheduleEmptyCleanup(roomCode, game);
      broadcast(roomCode);
    } else {
      broadcast(roomCode);
      game.maybeBotAct();
    }
  });
});

const HOST = process.env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  console.log(`Mahjong table → http://localhost:${PORT}`);
  console.log(`Share with teammates on your network using this machine's LAN IP.`);
});

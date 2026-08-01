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

app.use(express.static(path.join(__dirname, "public")));

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
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

function createGame(code) {
  const game = new Game(code, () => broadcast(code));
  rooms.set(code, game);
  return game;
}

io.on("connection", (socket) => {
  let roomCode = null;

  socket.on("create", ({ name }, cb) => {
    const code = makeCode();
    const game = createGame(code);
    const result = game.join(socket.id, name || "Host");
    if (!result.ok) return cb?.(result);
    roomCode = code;
    socket.join(code);
    cb?.({ ok: true, roomCode: code, seat: result.seat });
    broadcast(code);
  });

  socket.on("join", ({ roomCode: code, name }, cb) => {
    const game = rooms.get(String(code || "").toUpperCase());
    if (!game) return cb?.({ ok: false, error: "Room not found" });
    const result = game.join(socket.id, name || "Player");
    if (!result.ok) return cb?.(result);
    roomCode = game.roomCode;
    socket.join(roomCode);
    cb?.({ ok: true, roomCode, seat: result.seat });
    broadcast(roomCode);
  });

  socket.on("ready", ({ ready }, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    game.setReady(socket.id, ready);
    cb?.({ ok: true });
    broadcast(roomCode);
  });

  socket.on("fillBots", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    game.fillBots();
    cb?.({ ok: true });
    broadcast(roomCode);
  });

  socket.on("start", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.start();
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("discard", ({ tile }, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.discard(socket.id, tile);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("claim", ({ action, tiles }, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.claim(socket.id, action, tiles);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("selfWin", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.selfWin(socket.id);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("kong", ({ tile }, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.declareKong(socket.id, tile);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("nextRound", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.nextRound();
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("rematch", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.rematch();
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("pause", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.pause(socket.id);
    cb?.(result);
    broadcast(roomCode);
    game.maybeBotAct();
  });

  socket.on("resume", (_data, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.resume(socket.id);
    cb?.(result);
    broadcast(roomCode);
  });

  socket.on("quickChat", ({ id }, cb) => {
    const game = rooms.get(roomCode);
    if (!game) return cb?.({ ok: false });
    const result = game.quickChat(socket.id, id);
    cb?.(result);
    if (result.ok && result.chat) {
      io.to(roomCode).emit("quickChat", result.chat);
      broadcast(roomCode);
    }
  });

  socket.on("disconnect", () => {
    if (!roomCode) return;
    const game = rooms.get(roomCode);
    if (!game) return;
    game.leave(socket.id);
    if (game.humanCount() === 0 && game.phase === "lobby") {
      game.clearClaimTimer();
      rooms.delete(roomCode);
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

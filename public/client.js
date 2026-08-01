/* global io */
const socket = io();

/** Spoken / tooltip names: 万 · 条 · 饼 (两条/两饼 use 两). */
const TILE_NAME = {
  man1: "一万", man2: "两万", man3: "三万", man4: "四万", man5: "五万",
  man6: "六万", man7: "七万", man8: "八万", man9: "九万",
  pin1: "一饼", pin2: "两饼", pin3: "三饼", pin4: "四饼", pin5: "五饼",
  pin6: "六饼", pin7: "七饼", pin8: "八饼", pin9: "九饼",
  sou1: "一条", sou2: "两条", sou3: "三条", sou4: "四条", sou5: "五条",
  sou6: "六条", sou7: "七条", sou8: "八条", sou9: "九条",
  east: "东", south: "南", west: "西", north: "北",
  red: "红中", green: "发财", white: "白板",
};

function tileLabel(id) {
  return TILE_NAME[id] || id;
}

/**
 * Physical mahjong faces (layouts / colors from traditional sets & Wikipedia).
 * Circles = copper coins · Bamboo = coin-strings · Characters = 萬 myriads.
 */
const C = { g: "#1b7a3d", b: "#1a4f9c", r: "#c0392b", soft: "#f7f1e6" };

/** pin: [x, y, colorKey, radius?] — Wikipedia circle color rules */
const PIN = {
  1: null, // special large "pancake"
  2: [[32, 30, "g"], [68, 70, "b"]],
  3: [[28, 24, "g"], [50, 50, "r"], [72, 76, "b"]],
  4: [[30, 30, "b"], [70, 30, "g"], [30, 70, "g"], [70, 70, "b"]],
  5: [[30, 28, "b"], [70, 28, "g"], [50, 50, "r"], [30, 72, "g"], [70, 72, "b"]],
  // 2 green top, 4 red bottom with gap
  6: [
    [32, 22, "g"], [68, 22, "g"],
    [32, 58, "r"], [68, 58, "r"], [32, 80, "r"], [68, 80, "r"],
  ],
  // like 6 + 3rd green on diagonal
  7: [
    [28, 18, "g"], [50, 38, "g"], [72, 18, "g"],
    [32, 60, "r"], [68, 60, "r"], [32, 82, "r"], [68, 82, "r"],
  ],
  8: [
    [32, 14, "b"], [68, 14, "b"], [32, 36, "b"], [68, 36, "b"],
    [32, 64, "b"], [68, 64, "b"], [32, 86, "b"], [68, 86, "b"],
  ],
  // rows: green / red / blue
  9: [
    [24, 18, "g"], [50, 18, "g"], [76, 18, "g"],
    [24, 50, "r"], [50, 50, "r"], [76, 50, "r"],
    [24, 82, "b"], [50, 82, "b"], [76, 82, "b"],
  ],
};

/**
 * 条 layouts. Entries: [x, y, color, len?, rotDeg?]
 * 八条 uses tiles/Sou8.png · 九条 = 3×3, red center column.
 */
const SOU = {
  2: [[50, 28, "g"], [50, 72, "g"]],
  3: [[50, 26, "g"], [32, 72, "g"], [68, 72, "g"]],
  4: [[34, 28, "g"], [66, 28, "g"], [34, 72, "g"], [66, 72, "g"]],
  5: [[34, 22, "g"], [66, 22, "g"], [50, 50, "r"], [34, 78, "g"], [66, 78, "g"]],
  6: [
    [28, 28, "g"], [50, 28, "g"], [72, 28, "g"],
    [28, 72, "g"], [50, 72, "g"], [72, 72, "g"],
  ],
  7: [
    [50, 14, "r", 22],
    [28, 48, "g", 22], [50, 48, "g", 22], [72, 48, "g", 22],
    [28, 82, "g", 22], [50, 82, "g", 22], [72, 82, "g", 22],
  ],
  // 九条: compact 3×3
  9: [
    [24, 18, "g", 18], [50, 18, "r", 18], [76, 18, "g", 18],
    [24, 50, "g", 18], [50, 50, "r", 18], [76, 50, "g", 18],
    [24, 82, "g", 18], [50, 82, "r", 18], [76, 82, "g", 18],
  ],
};

// Traditional tile numerals; 伍 is the mahjong form of 5
const MAN_NUM = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "伍", 6: "六", 7: "七", 8: "八", 9: "九" };

function svgWrap(inner) {
  return `<svg class="tile-art" viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
}

function coin(x, y, color, r = 11) {
  const fill = C[color] || C.b;
  // Flat colored coin with light rim — like printed 筒
  return `
    <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.55}" fill="none" stroke="${C.soft}" stroke-width="${Math.max(1.2, r * 0.14)}" opacity="0.9"/>
    <circle cx="${x}" cy="${y}" r="${r * 0.22}" fill="${C.soft}" opacity="0.95"/>
  `;
}

function bigPancake() {
  // 一筒 / 大餅 — one large multi-color circle
  return `
    <circle cx="50" cy="50" r="36" fill="${C.b}"/>
    <circle cx="50" cy="50" r="28" fill="${C.soft}"/>
    <circle cx="50" cy="50" r="22" fill="${C.r}"/>
    <circle cx="50" cy="50" r="15" fill="${C.soft}"/>
    <circle cx="50" cy="50" r="10" fill="${C.g}"/>
    <circle cx="50" cy="50" r="4.5" fill="${C.soft}"/>
  `;
}

/** Straight bamboo stick — shaft + joints; small leaf only when there's room. */
function bambooStick(x, y, color, len = 30, rot = 0) {
  const fill = C[color] || C.g;
  const tip = color === "r" ? "#e07060" : "#4ec87a";
  const half = len / 2;
  const top = -half;
  const w = len < 22 ? 2.8 : 3.4;
  const showLeaf = len >= 24;
  const leaf = showLeaf
    ? `<path d="M0 ${top} L${w} ${top + 5} L0 ${top + 3.5} L${-w} ${top + 5} Z" fill="${tip}"/>`
    : "";
  const bodyTop = showLeaf ? top + 4 : top + 1;
  const bodyH = showLeaf ? len - 5 : len - 2;
  return `
    <g transform="translate(${x} ${y}) rotate(${rot})">
      ${leaf}
      <rect x="${-w}" y="${bodyTop}" width="${w * 2}" height="${bodyH}" rx="2" fill="${fill}"/>
      <line x1="${-w}" y1="${top + len * 0.35}" x2="${w}" y2="${top + len * 0.35}" stroke="${C.soft}" stroke-width="1.2" opacity="0.9"/>
      <line x1="${-w}" y1="${half - len * 0.28}" x2="${w}" y2="${half - len * 0.28}" stroke="${C.soft}" stroke-width="1.2" opacity="0.9"/>
    </g>
  `;
}

function peacockBird() {
  // Large 一索 bird (peacock/sparrow) filling the tile face
  return `
    <!-- tail feathers -->
    <path d="M58 58 Q78 40 86 22 Q70 32 62 48 Z" fill="${C.g}"/>
    <path d="M54 62 Q72 55 88 48 Q74 58 60 66 Z" fill="#2f9e57"/>
    <path d="M52 66 Q68 72 84 78 Q70 70 56 68 Z" fill="${C.b}"/>
    <circle cx="82" cy="28" r="3.2" fill="${C.r}"/>
    <circle cx="86" cy="52" r="2.6" fill="#d4a24c"/>
    <circle cx="80" cy="74" r="2.6" fill="${C.r}"/>
    <!-- body -->
    <ellipse cx="42" cy="52" rx="22" ry="18" fill="${C.g}"/>
    <ellipse cx="40" cy="54" rx="14" ry="11" fill="#2f9e57"/>
    <!-- wing -->
    <path d="M30 48 Q48 38 58 52 Q44 56 30 52 Z" fill="#156b36"/>
    <!-- neck + head -->
    <path d="M52 40 Q62 28 68 18" fill="none" stroke="${C.b}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="70" cy="16" r="7.5" fill="${C.b}"/>
    <circle cx="73" cy="14.5" r="1.8" fill="${C.soft}"/>
    <path d="M76 16 L84 14 L76 19 Z" fill="#d4a24c"/>
    <!-- crest -->
    <path d="M68 10 Q66 2 70 4" fill="none" stroke="${C.r}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M71 9 Q72 1 76 4" fill="none" stroke="#d4a24c" stroke-width="1.8" stroke-linecap="round"/>
    <!-- legs on bamboo stub -->
    <line x1="36" y1="68" x2="32" y2="86" stroke="#3a2416" stroke-width="2"/>
    <line x1="46" y1="68" x2="48" y2="86" stroke="#3a2416" stroke-width="2"/>
    <rect x="24" y="84" width="36" height="6" rx="2" fill="${C.g}" stroke="#156b36" stroke-width="1"/>
  `;
}

function renderPin(n) {
  if (n === 1) return svgWrap(bigPancake());
  const r = n >= 8 ? 9 : n === 9 ? 9 : 11;
  const dots = (PIN[n] || []).map(([x, y, c]) => coin(x, y, c, r)).join("");
  return svgWrap(dots);
}

function renderSou(n) {
  if (n === 1) return svgWrap(peacockBird());
  // 八条: use reference art (two stacked M's) — clearer than SVG geometry
  if (n === 8) {
    return `<img class="tile-face" src="tiles/Sou8.png" alt="八条" draggable="false" />`;
  }
  const defaultLen = n === 9 ? 18 : n === 7 ? 22 : n === 3 ? 28 : n <= 2 ? 34 : n >= 6 ? 24 : 28;
  const sticks = (SOU[n] || [])
    .map(([x, y, c, len, rot]) => bambooStick(x, y, c, len || defaultLen, rot || 0))
    .join("");
  return svgWrap(sticks);
}

function renderMan(n) {
  return svgWrap(`
    <text x="50" y="38" text-anchor="middle" dominant-baseline="middle" class="glyph man-num">${MAN_NUM[n]}</text>
    <text x="50" y="72" text-anchor="middle" dominant-baseline="middle" class="glyph man-wan">萬</text>
  `);
}

function renderTileArt(id) {
  // Honors first — "south" must not match bamboo prefix "sou"
  if (id === "white") {
    return svgWrap(
      `<rect x="16" y="12" width="68" height="76" rx="4" fill="none" stroke="${C.b}" stroke-width="6"/>`
    );
  }
  const honors = { east: "東", south: "南", west: "西", north: "北", red: "中", green: "發" };
  if (honors[id]) {
    const cls = id === "red" ? "dragon-red" : id === "green" ? "dragon-green" : "wind";
    return svgWrap(
      `<text x="50" y="56" text-anchor="middle" dominant-baseline="middle" class="glyph honor ${cls}">${honors[id]}</text>`
    );
  }
  if (/^pin[1-9]$/.test(id)) return renderPin(Number(id.slice(3)));
  if (/^sou[1-9]$/.test(id)) return renderSou(Number(id.slice(3)));
  if (/^man[1-9]$/.test(id)) return renderMan(Number(id.slice(3)));
  return "";
}

const $ = (id) => document.getElementById(id);
const lobby = $("lobby");
const tableScreen = $("table-screen");
const waiting = $("waiting");
const table = $("table");
const overlay = $("overlay");

let state = null;
let selectedTile = null;
let myReady = false;

function tileClass(id) {
  if (id === "red") return "red";
  if (id === "green") return "green";
  if (id === "white") return "white";
  if (/^man[1-9]$/.test(id)) return "man";
  if (/^pin[1-9]$/.test(id)) return "pin";
  if (/^sou[1-9]$/.test(id)) return "sou";
  return "honor";
}

function makeTile(id, opts = {}) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = [
    "tile",
    tileClass(id),
    opts.size || "",
    opts.back ? "back" : "",
    opts.selectable ? "selectable" : "",
    opts.selected ? "selected" : "",
    opts.drawn ? "drawn" : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!opts.back) el.innerHTML = renderTileArt(id);
  el.title = opts.drawn ? `${tileLabel(id)} (just drawn)` : tileLabel(id);
  if (opts.onClick) el.addEventListener("click", opts.onClick);
  if (opts.disabled) el.disabled = true;
  return el;
}

function showError(msg) {
  const el = $("lobby-error");
  el.hidden = !msg;
  el.textContent = msg || "";
}

function playerName() {
  return $("name-input").value.trim() || "Player";
}

function createRoom() {
  showError("");
  if (!socket.connected) {
    showError("Connecting… try again in a moment");
    return;
  }
  socket.emit("create", { name: playerName() }, (res) => {
    if (!res?.ok) return showError(res?.error || "Could not create room");
    enterRoom(res.roomCode);
  });
}

function joinRoom() {
  showError("");
  const roomCode = $("code-input").value.trim().toUpperCase();
  if (!roomCode) return showError("Enter a room code");
  if (!socket.connected) {
    showError("Connecting… try again in a moment");
    return;
  }
  socket.emit("join", { roomCode, name: playerName() }, (res) => {
    if (!res?.ok) return showError(res?.error || "Could not join");
    enterRoom(res.roomCode);
  });
}

$("btn-create").addEventListener("click", createRoom);
$("btn-join").addEventListener("click", joinRoom);
$("lobby-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("code-input").value.trim()) joinRoom();
  else createRoom();
});

function enterRoom(code) {
  lobby.hidden = true;
  tableScreen.hidden = false;
  $("room-code").textContent = code;
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url.toString());
}

$("copy-link").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    $("copy-link").textContent = "Copied!";
    setTimeout(() => ($("copy-link").textContent = "Copy link"), 1200);
  } catch {
    prompt("Copy this link:", window.location.href);
  }
});

$("btn-ready").addEventListener("click", () => {
  myReady = !myReady;
  socket.emit("ready", { ready: myReady });
});

$("btn-bots").addEventListener("click", () => socket.emit("fillBots", {}));
$("btn-start").addEventListener("click", () => socket.emit("start", {}));

let prevState = null;

socket.on("state", (s) => {
  if (typeof AudioFX !== "undefined") AudioFX.onState(prevState, s, TILE_NAME);
  prevState = s;
  state = s;
  render();
});

socket.on("quickChat", (chat) => {
  if (!chat) return;
  showChatBubble(chat);
  appendChatMessage(chat);
  const ttsOn = $("chat-tts")?.checked !== false;
  if (chat.voice && ttsOn && typeof AudioFX !== "undefined") {
    AudioFX.prime();
    AudioFX.speakDongbei(chat.text);
  }
});

socket.on("connect", () => {
  if (typeof VoiceChat !== "undefined") VoiceChat.setSocketId(socket.id);
});

socket.on("voice-signal", (payload) => {
  if (typeof VoiceChat !== "undefined") VoiceChat.onSignal(payload);
});

function syncMuteBtn() {
  const btn = $("btn-mute");
  if (!btn || typeof AudioFX === "undefined") return;
  btn.textContent = AudioFX.isMuted() ? "Sound off" : "Sound on";
}

function syncVoiceBtns() {
  if (typeof AudioFX === "undefined") return;
  const label = AudioFX.dialectLabel();
  const a = $("btn-voice");
  const b = $("btn-voice-lobby");
  if (a) a.textContent = label;
  if (b) b.textContent = label;
}

function cycleVoice() {
  if (typeof AudioFX === "undefined") return;
  AudioFX.prime();
  AudioFX.toggleDialect();
  syncVoiceBtns();
  AudioFX.previewVoice();
}

$("btn-mute")?.addEventListener("click", () => {
  AudioFX.toggleMute();
  syncMuteBtn();
});
$("btn-voice")?.addEventListener("click", cycleVoice);
$("btn-voice-lobby")?.addEventListener("click", cycleVoice);

function syncPauseUI() {
  const pauseBtn = $("btn-pause");
  const resumeBtn = $("btn-resume");
  const banner = $("afk-banner");
  const dock = $("chat-dock");
  const inGame =
    state &&
    state.mySeat >= 0 &&
    (state.phase === "playing" || state.phase === "claim");
  const inRoom = state && state.mySeat >= 0 && state.phase !== undefined;
  const paused = !!(state && state.mePaused);
  if (pauseBtn) pauseBtn.hidden = !inGame || paused;
  if (resumeBtn) resumeBtn.hidden = !inGame || !paused;
  if (banner) banner.hidden = !paused;
  if (dock) dock.hidden = !inRoom;
}

function syncVoicePeers() {
  if (typeof VoiceChat === "undefined" || !state?.voicePeers) return;
  VoiceChat.setSocketId(socket.id);
  VoiceChat.syncPeers(state.voicePeers.map((p) => p.id));
}

$("chat-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("chat-input");
  const text = input?.value?.trim();
  if (!text) return;
  if (typeof AudioFX !== "undefined") AudioFX.prime();
  const voice = !!$("chat-tts")?.checked;
  socket.emit("chat", { text, voice }, (res) => {
    if (res && res.ok === false && res.error) showToast(res.error);
    else if (input) input.value = "";
  });
});

// Push-to-talk (real mic)
function bindPtt() {
  const btn = $("btn-ptt");
  if (!btn || typeof VoiceChat === "undefined") return;
  const start = async (ev) => {
    ev.preventDefault();
    try {
      if (typeof AudioFX !== "undefined") AudioFX.prime();
      await VoiceChat.ensureMic();
      VoiceChat.setTalking(true);
    } catch (_) {
      showToast("无法打开麦克风（需 HTTPS 并允许权限）");
    }
  };
  const end = (ev) => {
    ev.preventDefault();
    VoiceChat.setTalking(false);
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", end);
  btn.addEventListener("pointerleave", end);
  btn.addEventListener("pointercancel", end);
}
bindPtt();

$("btn-pause")?.addEventListener("click", () => {
  if (typeof AudioFX !== "undefined") AudioFX.prime();
  socket.emit("pause", {}, (res) => {
    if (res && res.ok === false && res.error) showToast(res.error);
  });
});

$("btn-resume")?.addEventListener("click", () => {
  if (typeof AudioFX !== "undefined") AudioFX.prime();
  socket.emit("resume", {}, (res) => {
    if (res && res.ok === false && res.error) showToast(res.error);
  });
});

// Coming back to the tab while paused → offer control (auto-resume on tap of Resume only;
// visibility alone doesn't steal mid-bot-move unexpectedly — user taps Resume)

syncMuteBtn();
syncVoiceBtns();

// iPhone: audio only unlocks inside a real tap — prime on every main button
["btn-create", "btn-join", "btn-ready", "btn-start", "btn-bots", "btn-mute", "btn-voice", "btn-voice-lobby", "btn-pause", "btn-resume"].forEach(
  (id) => {
    $(id)?.addEventListener("click", () => AudioFX.prime(), { once: false });
  }
);

function render() {
  if (!state) return;
  $("room-code").textContent = state.roomCode;
  renderScoreboard();
  syncPauseUI();

  if (state.phase === "lobby") {
    waiting.hidden = false;
    table.hidden = true;
    overlay.hidden = true;
    const banner = $("afk-banner");
    if (banner) banner.hidden = true;
    renderWaiting();
    renderChatMessages();
    renderChatQuick();
    syncVoicePeers();
    return;
  }

  waiting.hidden = true;
  table.hidden = false;
  renderTable();
  renderQuickChat();
  renderChatMessages();
  renderChatQuick();
  syncVoicePeers();

  if (state.phase === "round_end" || state.phase === "match_end") {
    renderOverlay();
  } else {
    overlay.hidden = true;
  }
}

const DEFAULT_QUICK = [
  { id: "hurry", text: "麻利点" },
  { id: "deal", text: "快出牌啊" },
  { id: "wait", text: "等会儿" },
  { id: "brb", text: "马上回来" },
  { id: "calm", text: "别催呗" },
  { id: "sorry", text: "不好意思啊" },
  { id: "thanks", text: "谢谢啊" },
];

function renderQuickChat() {
  const wrap = $("quick-chat");
  const bar = $("quick-chat-bar");
  if (!wrap || !bar) return;
  const show =
    state &&
    state.mySeat >= 0 &&
    (state.phase === "playing" || state.phase === "claim" || state.phase === "round_end");
  wrap.hidden = !show;
  if (!show) return;

  const phrases = state.quickPhrases?.length ? state.quickPhrases : DEFAULT_QUICK;
  if (bar.dataset.built === phrases.map((p) => p.id).join(",")) return;
  bar.dataset.built = phrases.map((p) => p.id).join(",");
  bar.innerHTML = "";
  for (const p of phrases) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "quick-chat-btn";
    b.textContent = p.text;
    b.addEventListener("click", () => {
      if (typeof AudioFX !== "undefined") AudioFX.prime();
      socket.emit("quickChat", { id: p.id }, (res) => {
        if (res && res.ok === false && res.error) showToast(res.error);
      });
    });
    bar.appendChild(b);
  }
}

function showChatBubble(chat) {
  const el = $("chat-bubble");
  if (!el) return;
  el.innerHTML = `<strong>${escapeHtml(chat.name)}</strong> ${escapeHtml(chat.text)}`;
  el.hidden = false;
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
  clearTimeout(showChatBubble._t);
  showChatBubble._t = setTimeout(() => {
    el.hidden = true;
  }, 2800);
}

function appendChatMessage(chat) {
  if (!state) return;
  if (!state.chatMessages) state.chatMessages = [];
  const last = state.chatMessages[state.chatMessages.length - 1];
  if (last && last.t === chat.t && last.seat === chat.seat && last.text === chat.text) return;
  state.chatMessages.push(chat);
  if (state.chatMessages.length > 50) state.chatMessages.shift();
  renderChatMessages();
}

function renderChatMessages() {
  const el = $("chat-messages");
  if (!el || !state) return;
  const msgs = state.chatMessages || [];
  el.innerHTML = msgs
    .map((m) => {
      const mine = m.seat === state.mySeat;
      return `<div class="chat-line ${mine ? "mine" : ""}"><span class="chat-name">${escapeHtml(
        m.name
      )}</span><span class="chat-text">${escapeHtml(m.text)}</span></div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
}

function renderChatQuick() {
  const bar = $("chat-quick");
  if (!bar || !state) return;
  const phrases = state.quickPhrases?.length ? state.quickPhrases : DEFAULT_QUICK;
  if (bar.dataset.built === phrases.map((p) => p.id).join(",")) return;
  bar.dataset.built = phrases.map((p) => p.id).join(",");
  bar.innerHTML = "";
  for (const p of phrases) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "quick-chat-btn";
    b.textContent = p.text;
    b.addEventListener("click", () => {
      if (typeof AudioFX !== "undefined") AudioFX.prime();
      socket.emit("quickChat", { id: p.id }, (res) => {
        if (res && res.ok === false && res.error) showToast(res.error);
      });
    });
    bar.appendChild(b);
  }
}

function renderScoreboard() {
  const el = $("scoreboard");
  if (!el || !state?.seats) return;
  el.innerHTML = state.seats
    .map(
      (s) =>
        `<span class="score-pill ${s.seat === state.mySeat ? "me" : ""}">${escapeHtml(
          s.name || s.seatName
        )} <strong>${s.score}</strong></span>`
    )
    .join("");
}

function renderWaiting() {
  const list = $("seat-list");
  list.innerHTML = "";
  for (const seat of state.seats) {
    const card = document.createElement("div");
    card.className = `seat-card ${seat.name ? "" : "empty"}`;
    const status = !seat.name
      ? "Empty"
      : seat.isBot
        ? "Bot"
        : seat.ready
          ? "Ready"
          : "Not ready";
    card.innerHTML = `
      <div class="seat-name">${seat.seatName}</div>
      <div class="player-name">${seat.name || "Waiting…"}</div>
      <div class="meta">${status} · ${seat.score} pts</div>
    `;
    list.appendChild(card);
  }

  const me = state.seats[state.mySeat];
  myReady = !!me?.ready;
  $("btn-ready").textContent = myReady ? "Unready" : "Ready";
  $("btn-ready").classList.toggle("primary", !myReady);

  const allReady = state.seats.every((s) => s.name && (s.isBot || s.ready));
  const full = state.seats.every((s) => s.name);
  $("btn-start").hidden = !(full && allReady && state.mySeat === 0);
}

function relativeSeats() {
  const me = state.mySeat ?? 0;
  return {
    me,
    right: (me + 1) % 4,
    far: (me + 2) % 4,
    left: (me + 3) % 4,
  };
}

function renderSeatPanel(el, seatIndex, opts = {}) {
  const seat = state.seats[seatIndex];
  el.innerHTML = "";
  const label = document.createElement("div");
  label.className = `seat-label ${seat.isTurn ? "turn" : ""}`;
  label.innerHTML = `<span class="who">${seat.name || "—"}</span> · ${seat.seatName} · ${seat.score} pts`;
  el.appendChild(label);

  if (seat.melds?.length) {
    const melds = document.createElement("div");
    melds.className = "melds";
    for (const m of seat.melds) {
      const g = document.createElement("div");
      g.className = "meld";
      for (const t of m.tiles) g.appendChild(makeTile(t, { size: "tiny" }));
      melds.appendChild(g);
    }
    el.appendChild(melds);
  }

  if (opts.showHand && seat.hand) {
    const hand = document.createElement("div");
    hand.className = "tiles";
    const canDiscard =
      state.phase === "playing" &&
      seat.isTurn &&
      seat.seat === state.mySeat &&
      !state.mePaused &&
      !seat.isBot &&
      seat.hand.length % 3 === 2;

    seat.hand.forEach((t, i) => {
      const isDrawn =
        seat.seat === state.mySeat &&
        state.lastDraw != null &&
        state.lastDrawIndex === i &&
        state.lastDraw === t;
      hand.appendChild(
        makeTile(t, {
          selectable: canDiscard,
          selected: selectedTile === t,
          drawn: isDrawn,
          onClick: canDiscard
            ? () => {
                if (selectedTile === t) {
                  if (typeof AudioFX !== "undefined") AudioFX.prime();
                  socket.emit("discard", { tile: t }, () => {
                    selectedTile = null;
                  });
                } else {
                  selectedTile = t;
                  renderTable();
                }
              }
            : null,
        })
      );
    });
    el.appendChild(hand);
    if (canDiscard) {
      const hint = document.createElement("div");
      hint.className = "hand-hint";
      hint.textContent = selectedTile ? "Tap again to discard" : "Select a tile to discard";
      el.appendChild(hint);
    }
  } else {
    const backs = document.createElement("div");
    backs.className = "tiles";
    const n = Math.min(seat.handCount || 0, 14);
    for (let i = 0; i < n; i++) backs.appendChild(makeTile("east", { back: true, size: opts.side ? "tiny" : "small" }));
    el.appendChild(backs);
  }

  if (seat.discards?.length) {
    const d = document.createElement("div");
    d.className = "discards";
    for (const t of seat.discards.slice(-12)) d.appendChild(makeTile(t, { size: "tiny" }));
    el.appendChild(d);
  }
}

function renderTable() {
  const { me, left, right, far } = relativeSeats();
  renderSeatPanel($("me"), me, { showHand: true });
  renderSeatPanel($("opp-far"), far, {});
  renderSeatPanel($("opp-left"), left, { side: true });
  renderSeatPanel($("opp-right"), right, { side: true });

  $("round-label").textContent = `Round ${state.round}`;
  $("wall-count").textContent = `Wall · ${state.wallCount}`;
  const turnSeat = state.seats[state.turn];
  if (state.phase === "claim") {
    $("turn-label").textContent = "有人可以叫牌…";
  } else if (turnSeat) {
    const thinking = turnSeat.isBot || turnSeat.paused ? "想一会儿" : "出牌中";
    $("turn-label").textContent = `轮到 ${turnSeat.name} · ${thinking}`;
  } else {
    $("turn-label").textContent = "—";
  }

  const ld = $("last-discard");
  ld.innerHTML = "";
  if (state.lastDiscard) {
    ld.appendChild(makeTile(state.lastDiscard, {}));
  }

  renderClaims();
  renderActions();
  renderLog();
}

let claimTimerIv = null;

function renderClaims() {
  const overlay = $("claim-overlay");
  const bar = $("claim-bar");
  const tileBox = $("claim-tile");
  const title = $("claim-title");
  const timerEl = $("claim-timer");
  if (!overlay || !bar) return;

  bar.innerHTML = "";
  if (tileBox) tileBox.innerHTML = "";
  if (claimTimerIv) {
    clearInterval(claimTimerIv);
    claimTimerIv = null;
  }

  const canClaim = state.phase === "claim" && state.claims?.length;
  if (!canClaim) {
    overlay.hidden = true;
    return;
  }

  overlay.hidden = false;
  if (title) {
    // List EVERY legal action — do not collapse to the highest-priority one.
    // (胡>槓>碰>吃 applies only when different seats compete, not for this player's choices.)
    const labelOf = { hu: "胡", kong: "槓", pong: "碰", chi: "吃" };
    const order = { hu: 0, kong: 1, pong: 2, chi: 3 };
    const kinds = [...new Set(state.claims.map((c) => c.action))]
      .filter((a) => labelOf[a])
      .sort((a, b) => order[a] - order[b]);
    title.textContent = kinds.length ? `可以${kinds.map((k) => labelOf[k]).join(" / ")}！` : "可以叫牌";
  }
  if (tileBox && state.lastDiscard) {
    tileBox.appendChild(makeTile(state.lastDiscard, {}));
  }

  const add = (label, action, tiles, cls = "", titleText = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn claim-btn ${cls}`;
    b.textContent = label;
    if (titleText) b.title = titleText;
    b.addEventListener("click", () => {
      if (typeof AudioFX !== "undefined") AudioFX.prime();
      socket.emit("claim", { action, tiles }, (res) => {
        if (res && res.ok === false && res.error) showToast(res.error);
      });
    });
    bar.appendChild(b);
  };

  // Show all legal buttons. Sort is display order only — never drop 吃 when 碰 is also legal.
  const order = { hu: 0, kong: 1, pong: 2, chi: 3 };
  const sorted = [...state.claims].sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9));
  for (const c of sorted) {
    if (c.action === "hu") add("胡", "hu", null, "hu");
    else if (c.action === "kong") add("槓", "kong", null, "kong");
    else if (c.action === "pong") add("碰", "pong", null, "pong");
    else if (c.action === "chi") add(`吃 ${c.tiles.map((t) => tileLabel(t)).join("")}`, "chi", c.tiles, "chi");
  }
  add("过", "pass", null, "pass");

  // Countdown
  const updateTimer = () => {
    if (!timerEl || !state.claimDeadline) {
      if (timerEl) timerEl.textContent = "";
      return;
    }
    const left = Math.max(0, Math.ceil((state.claimDeadline - Date.now()) / 1000));
    timerEl.textContent = `${left}s`;
  };
  updateTimer();
  claimTimerIv = setInterval(updateTimer, 200);

  if (typeof AudioFX !== "undefined" && state.claims.some((c) => c.action === "pong")) {
    // Soft cue when 碰 becomes available (dedupe by deadline)
    if (renderClaims._lastDeadline !== state.claimDeadline) {
      renderClaims._lastDeadline = state.claimDeadline;
      AudioFX.softClick();
    }
  }
}

function renderActions() {
  const bar = $("action-bar");
  bar.innerHTML = "";
  const mine = state.mySeat === state.turn && state.phase === "playing";
  if (!mine) {
    bar.hidden = true;
    return;
  }
  const buttons = [];
  if (state.canSelfWin) {
    buttons.push([
      "胡",
      () => {
        socket.emit("selfWin", {}, (res) => {
          if (res && res.ok === false && res.error) showToast(res.error);
        });
      },
      "hu",
      "",
    ]);
  }
  for (const t of state.closedKongs || []) {
    buttons.push([`槓 ${tileLabel(t)}`, () => socket.emit("kong", { tile: t }), "", ""]);
  }
  if (!buttons.length) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  for (const [label, fn, cls, titleText] of buttons) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `btn ${cls}`;
    b.textContent = label;
    if (titleText) b.title = titleText;
    b.addEventListener("click", fn);
    bar.appendChild(b);
  }
}

function showToast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

function renderLog() {
  const el = $("log");
  el.innerHTML = (state.log || [])
    .map((l) => `<div>${escapeHtml(l.msg)}</div>`)
    .join("");
  el.scrollTop = el.scrollHeight;
}

function renderOverlay() {
  overlay.hidden = false;
  const title = $("overlay-title");
  const body = $("overlay-body");
  const actions = $("overlay-actions");
  actions.innerHTML = "";

  if (state.phase === "match_end") {
    const ranked = [...state.seats].sort((a, b) => b.score - a.score);
    const top = ranked[0];
    const tied = ranked.filter((s) => s.score === top.score).length > 1;
    title.textContent = tied ? "Match draw" : `${top.name} wins the match`;
    body.textContent = ranked.map((s) => `${s.name}: ${s.score}`).join(" · ");
    const btn = document.createElement("button");
    btn.className = "btn primary";
    btn.textContent = "Back to lobby";
    btn.addEventListener("click", () => socket.emit("rematch", {}));
    actions.appendChild(btn);
    return;
  }

  const info = state.winInfo;
  if (info?.draw) {
    title.textContent = "Draw game";
    body.textContent = "The wall is empty. No winner this round.";
  } else if (info) {
    const how = info.how === "self" ? "自摸" : "食糊";
    const faanBits = (info.items || []).map((i) => `${i.zh}(+${i.faan})`).join(" · ");
    title.textContent = `${info.name} wins! ${info.faan}番`;
    body.textContent = `${how} · +${info.points} pts · ${faanBits || "—"}`;
  } else {
    title.textContent = "Round over";
    body.textContent = "";
  }

  const next = document.createElement("button");
  next.className = "btn primary";
  next.textContent = state.round >= 4 ? "See match result" : "Next round";
  next.addEventListener("click", () => socket.emit("nextRound", {}));
  actions.appendChild(next);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Auto-join from ?room=CODE
(function boot() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) $("code-input").value = room.toUpperCase();
})();

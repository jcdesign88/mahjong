/**
 * Mahjong table audio — Chinese callouts + tile SFX.
 * Voice: 普通话 (简体 / zh-CN) or 粤语 (zh-HK).
 */

const AudioFX = (() => {
  let muted = localStorage.getItem("mahjong-muted") === "1";
  /** @type {'mandarin'|'cantonese'} */
  let dialect = localStorage.getItem("mahjong-voice") === "cantonese" ? "cantonese" : "mandarin";
  let ctx = null;
  let lastLogT = 0;
  let primed = false;

  const CALLS = {
    mandarin: {
      chi: "吃",
      pong: "碰",
      kong: "杠",
      hu: "胡",
      tsumo: "自摸",
      start: "开局",
      draw: "流局",
    },
    cantonese: {
      chi: "吃",
      pong: "碰",
      kong: "槓",
      hu: "胡",
      tsumo: "自摸",
      start: "開局",
      draw: "流局",
    },
  };

  /** Map traditional mahjong glyphs → simplified for Mandarin TTS */
  function toSimplified(text) {
    return String(text)
      .replace(/萬/g, "万")
      .replace(/東/g, "东")
      .replace(/發/g, "发")
      .replace(/槓/g, "杠")
      .replace(/開/g, "开")
      .replace(/門/g, "门")
      .replace(/對/g, "对")
      .replace(/紅/g, "红")
      .replace(/國/g, "国")
      .replace(/風/g, "风")
      .replace(/圓/g, "圆")
      .replace(/環/g, "环")
      .replace(/羅/g, "罗")
      .replace(/漢/g, "汉")
      .replace(/麼/g, "么")
      .replace(/無/g, "无")
      .replace(/個/g, "个")
      .replace(/撈/g, "捞")
      .replace(/月/g, "月")
      .replace(/糊/g, "胡");
  }

  function call(key) {
    return CALLS[dialect][key] || CALLS.mandarin[key];
  }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx?.state === "suspended") ctx.resume();
    return ctx;
  }

  function prime() {
    if (primed) return;
    primed = true;
    ensureCtx();
    try {
      speechSynthesis.getVoices();
    } catch (_) {
      /* ignore */
    }
  }

  function pickVoice() {
    const voices = speechSynthesis.getVoices?.() || [];
    if (dialect === "cantonese") {
      const prefer = [
        (v) => /zh[-_]?HK|yue|cantonese|广东|香港/i.test(`${v.lang} ${v.name}`),
        (v) => /zh[-_]?TW/i.test(v.lang),
        (v) => /^zh/i.test(v.lang),
      ];
      for (const test of prefer) {
        const hit = voices.find(test);
        if (hit) return hit;
      }
      return null;
    }
    // Mandarin / Simplified Chinese
    const prefer = [
      (v) => /zh[-_]?CN/i.test(v.lang),
      (v) => /chinese\s*\(?china\)?|普通话|大陆|xiaoxiao|yaoyao|huihui|kangkang/i.test(v.name),
      (v) => /cmn[-_]?hans|mandarin/i.test(`${v.lang} ${v.name}`),
      (v) => /zh[-_]?TW/i.test(v.lang),
      (v) => /^zh/i.test(v.lang),
    ];
    for (const test of prefer) {
      const hit = voices.find(test);
      if (hit) return hit;
    }
    return null;
  }

  function speak(text) {
    if (muted || !text || !window.speechSynthesis) return;
    prime();
    try {
      speechSynthesis.cancel();
      const spoken = dialect === "mandarin" ? toSimplified(text) : text;
      const u = new SpeechSynthesisUtterance(spoken);
      const voice = pickVoice();
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = dialect === "cantonese" ? "zh-HK" : "zh-CN";
      }
      u.rate = dialect === "cantonese" ? 1.05 : 1.0;
      u.pitch = 1;
      u.volume = 1;
      speechSynthesis.speak(u);
    } catch (_) {
      /* ignore */
    }
  }

  function tone(freq, dur, type = "triangle", gain = 0.08, when = 0) {
    const ac = ensureCtx();
    if (!ac || muted) return;
    const t0 = ac.currentTime + when;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst(dur = 0.05, gain = 0.05) {
    const ac = ensureCtx();
    if (!ac || muted) return;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource();
    const g = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(ac.destination);
    src.start();
  }

  function discardClack() {
    if (muted) return;
    prime();
    noiseBurst(0.055, 0.1);
    tone(280, 0.07, "square", 0.07);
    tone(160, 0.1, "triangle", 0.08, 0.015);
    tone(90, 0.12, "sine", 0.05, 0.02);
  }

  function softClick() {
    if (muted) return;
    prime();
    tone(660, 0.04, "sine", 0.03);
  }

  function winChime() {
    if (muted) return;
    prime();
    tone(523.25, 0.12, "sine", 0.07);
    tone(659.25, 0.14, "sine", 0.07, 0.1);
    tone(783.99, 0.22, "sine", 0.08, 0.2);
  }

  function setMuted(next) {
    muted = !!next;
    localStorage.setItem("mahjong-muted", muted ? "1" : "0");
    if (muted) {
      try {
        speechSynthesis.cancel();
      } catch (_) {
        /* ignore */
      }
    }
    return muted;
  }

  function toggleMute() {
    return setMuted(!muted);
  }

  function isMuted() {
    return muted;
  }

  function getDialect() {
    return dialect;
  }

  function setDialect(next) {
    dialect = next === "cantonese" ? "cantonese" : "mandarin";
    localStorage.setItem("mahjong-voice", dialect);
    return dialect;
  }

  function toggleDialect() {
    return setDialect(dialect === "mandarin" ? "cantonese" : "mandarin");
  }

  function dialectLabel() {
    return dialect === "cantonese" ? "粤语" : "普通话";
  }

  /** Preview current voice */
  function previewVoice() {
    speak(dialect === "cantonese" ? "碰" : "碰");
  }

  function onState(prev, next, tileNames = {}) {
    if (!next) return;

    const logs = next.log || [];

    if (!prev) {
      for (const entry of logs) {
        if (entry?.t > lastLogT) lastLogT = entry.t;
      }
      return;
    }

    if (prev.phase === "lobby" && next.phase === "playing") {
      speak(call("start"));
      softClick();
    }

    const discarded =
      next.lastDiscard &&
      (next.lastDiscard !== prev.lastDiscard || next.lastDiscarder !== prev.lastDiscarder) &&
      (next.phase === "claim" || next.phase === "playing");
    if (discarded) {
      discardClack();
      const label = tileNames[next.lastDiscard];
      if (label) speak(label);
    }

    for (const entry of logs) {
      if (!entry?.t || entry.t <= lastLogT) continue;
      lastLogT = entry.t;
      const msg = entry.msg || "";

      // Priority callouts: check 胡/自摸 before 碰/吃/槓
      if (/wins!|食糊|自摸/i.test(msg) && /番/.test(msg)) {
        const self = next.winInfo?.how === "self";
        speak(self ? call("tsumo") : call("hu"));
        winChime();
      } else if (/槓|杠/.test(msg) && !/discarded|出牌/.test(msg)) {
        speak(call("kong"));
        softClick();
      } else if (/碰/.test(msg)) {
        speak(call("pong"));
        softClick();
      } else if (/吃/.test(msg)) {
        speak(call("chi"));
        softClick();
      } else if (/Wall empty|流局/i.test(msg) && next.winInfo?.draw) {
        speak(call("draw"));
      }
    }

    if (
      prev.phase !== "round_end" &&
      next.phase === "round_end" &&
      next.winInfo &&
      !next.winInfo.draw
    ) {
      const last = logs[logs.length - 1];
      if (last && !/wins!|番/.test(last.msg || "")) {
        speak(next.winInfo.how === "self" ? call("tsumo") : call("hu"));
        winChime();
      }
    }
  }

  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.onvoiceschanged = () => pickVoice();
  }

  return {
    prime,
    onState,
    toggleMute,
    isMuted,
    setMuted,
    speak,
    discardClack,
    softClick,
    getDialect,
    setDialect,
    toggleDialect,
    dialectLabel,
    previewVoice,
  };
})();

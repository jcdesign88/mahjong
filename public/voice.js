/**
 * Real microphone voice chat (WebRTC) — hold-to-talk.
 * This is your actual voice, NOT text-to-speech.
 * Needs: HTTPS (or localhost), mic permission, and ≥1 other human in the room.
 */
const VoiceChat = (() => {
  const peers = new Map(); // remoteSocketId -> { pc, audio, makingOffer, polite }
  let localStream = null;
  let mySocketId = null;
  let talking = false;
  let lastPeerIds = [];
  let lastError = null;

  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  function setSocketId(id) {
    mySocketId = id || null;
  }

  function peerCount() {
    return lastPeerIds.filter((id) => id && id !== mySocketId).length;
  }

  function connectedCount() {
    let n = 0;
    for (const { pc } of peers.values()) {
      const s = pc.connectionState;
      if (s === "connected" || s === "connecting") n++;
    }
    return n;
  }

  function isSecureOk() {
    return typeof window !== "undefined" && (window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1");
  }

  function updatePttHint() {
    const btn = document.getElementById("btn-ptt");
    if (!btn) return;
    const n = peerCount();
    if (!isSecureOk()) {
      btn.title = "按住说话 — 需要 HTTPS（或本机 localhost）才能用麦克风";
    } else if (n > 0) {
      btn.title = `按住说话 — 真人麦克风（${n} 位可听）`;
    } else {
      btn.title = "按住说话 — 真人麦克风（房间里需要其他真人玩家）";
    }
    btn.dataset.peers = String(n);
  }

  /** Find the audio sender (including null-track sendrecv transceiver). */
  function findAudioSender(pc) {
    const withTrack = pc.getSenders().find((s) => s.track?.kind === "audio");
    if (withTrack) return withTrack;
    const tr = pc.getTransceivers().find(
      (t) =>
        t.receiver?.track?.kind === "audio" ||
        t.sender?.track?.kind === "audio" ||
        // Pre-negotiated audio-only sendrecv with no track yet
        (t.sender && !t.sender.track && (!t.receiver?.track || t.receiver.track.kind === "audio"))
    );
    return tr?.sender || pc.getSenders()[0] || null;
  }

  /**
   * Attach local mic tracks. Prefer replaceTrack on existing audio sender
   * so we don't need renegotiation. Returns true if addTrack forced a renego.
   */
  async function attachLocalTracks(pc) {
    if (!localStream) return false;
    let needRenego = false;
    for (const track of localStream.getAudioTracks()) {
      track.enabled = talking;
      const sender = findAudioSender(pc);
      if (sender) {
        try {
          await sender.replaceTrack(track);
          continue;
        } catch (err) {
          console.warn("voice replaceTrack failed", err);
        }
      }
      pc.addTrack(track, localStream);
      needRenego = true;
    }
    return needRenego;
  }

  async function renegotiate(remoteId) {
    const entry = peers.get(remoteId);
    if (!entry || !mySocketId) return;
    const { pc } = entry;
    if (entry.makingOffer) return;
    // Only the stable offerer (lexicographically smaller id) starts renegotiation
    if (mySocketId > remoteId) return;
    if (pc.signalingState !== "stable") return;
    try {
      entry.makingOffer = true;
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("voice-signal", {
        to: remoteId,
        data: { type: "offer", sdp: sdpPayload(pc.localDescription) },
      });
    } catch (err) {
      console.warn("voice renegotiate failed", err);
    } finally {
      entry.makingOffer = false;
    }
  }

  async function ensureMic() {
    lastError = null;
    if (!navigator.mediaDevices?.getUserMedia) {
      lastError = "unsupported";
      throw new Error("此浏览器不支持麦克风");
    }
    if (!isSecureOk()) {
      lastError = "insecure";
      throw new Error("麦克风需要 HTTPS（手机请用 https:// 打开，或双方都在电脑 localhost）");
    }
    if (localStream) {
      const live = localStream.getAudioTracks().some((t) => t.readyState === "live");
      if (live) {
        localStream.getAudioTracks().forEach((t) => {
          t.enabled = talking;
        });
        return localStream;
      }
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      lastError = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError" ? "denied" : "failed";
      throw err;
    }
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = talking;
    });
    // Attach mic to peers created before permission — replaceTrack, renego if needed
    for (const [remoteId, { pc }] of peers) {
      const needRenego = await attachLocalTracks(pc);
      if (needRenego) await renegotiate(remoteId);
    }
    return localStream;
  }

  function resumeRemoteAudio() {
    for (const { audio } of peers.values()) {
      if (!audio) continue;
      try {
        audio.muted = false;
        const p = audio.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch (_) {
        /* ignore */
      }
    }
  }

  function setTalking(on) {
    talking = !!on;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = talking;
      });
    }
    if (talking) resumeRemoteAudio();
    const btn = document.getElementById("btn-ptt");
    if (btn) {
      btn.classList.toggle("live", talking);
      btn.textContent = talking ? "开始说话" : "按住说话";
    }
  }

  function isTalking() {
    return talking;
  }

  function sdpPayload(desc) {
    return { type: desc.type, sdp: desc.sdp };
  }

  async function ensurePeer(remoteId, asOfferer) {
    if (!remoteId || !mySocketId || remoteId === mySocketId) return null;
    if (peers.has(remoteId)) return peers.get(remoteId);

    const pc = new RTCPeerConnection({ iceServers });
    // Smaller id is impolite (always offers); larger is polite (yields on glare)
    const polite = mySocketId > remoteId;
    const entry = { pc, audio: null, makingOffer: false, polite, ignoreOffer: false };
    peers.set(remoteId, entry);

    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        track.enabled = talking;
        pc.addTrack(track, localStream);
      }
    } else {
      // sendrecv (not recvonly) so later replaceTrack can send without renegotiation
      pc.addTransceiver("audio", { direction: "sendrecv" });
    }

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      socket.emit("voice-signal", {
        to: remoteId,
        data: { type: "ice", candidate: ev.candidate.toJSON() },
      });
    };

    pc.ontrack = (ev) => {
      let audio = entry.audio;
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.setAttribute("playsinline", "true");
        audio.setAttribute("webkit-playsinline", "true");
        audio.style.display = "none";
        document.body.appendChild(audio);
        entry.audio = audio;
      }
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      if (audio.srcObject !== stream) audio.srcObject = stream;
      audio.play().catch(() => {
        /* autoplay may need a gesture — PTT press calls resumeRemoteAudio */
      });
    };

    pc.onconnectionstatechange = () => {
      updatePttHint();
      if (pc.connectionState === "failed") {
        try {
          pc.restartIce();
        } catch (_) {
          teardownPeer(remoteId);
        }
      } else if (pc.connectionState === "closed") {
        teardownPeer(remoteId);
      }
    };

    if (asOfferer) {
      try {
        entry.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("voice-signal", {
          to: remoteId,
          data: { type: "offer", sdp: sdpPayload(pc.localDescription) },
        });
      } catch (err) {
        console.warn("voice offer failed", err);
        lastError = "signal";
      } finally {
        entry.makingOffer = false;
      }
    }

    return entry;
  }

  async function onSignal({ from, data }) {
    if (!from || !data || from === mySocketId) return;
    try {
      if (data.type === "offer") {
        const entry = await ensurePeer(from, false);
        if (!entry) return;
        const { pc } = entry;
        const offerCollision = entry.makingOffer || pc.signalingState !== "stable";
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return; // glare: impolite peer ignores remote offer
        if (offerCollision) {
          try {
            await pc.setLocalDescription({ type: "rollback" });
          } catch (_) {
            /* ignore */
          }
        }
        await pc.setRemoteDescription(data.sdp);
        // Upgrade / attach mic onto the negotiated sendrecv m-line
        if (localStream) {
          await attachLocalTracks(pc);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice-signal", {
          to: from,
          data: { type: "answer", sdp: sdpPayload(pc.localDescription) },
        });
      } else if (data.type === "answer") {
        const entry = peers.get(from);
        if (!entry) return;
        if (entry.pc.signalingState === "have-local-offer") {
          await entry.pc.setRemoteDescription(data.sdp);
        }
      } else if (data.type === "ice" && data.candidate) {
        const entry = peers.get(from) || (await ensurePeer(from, false));
        if (!entry || entry.ignoreOffer) return;
        try {
          await entry.pc.addIceCandidate(data.candidate);
        } catch (_) {
          /* ignore early ICE */
        }
      }
    } catch (err) {
      console.warn("voice signal error", err);
      lastError = "signal";
    }
  }

  function teardownPeer(remoteId) {
    const entry = peers.get(remoteId);
    if (!entry) return;
    try {
      entry.pc.close();
    } catch (_) {
      /* ignore */
    }
    if (entry.audio) {
      entry.audio.srcObject = null;
      entry.audio.remove();
    }
    peers.delete(remoteId);
  }

  async function syncPeers(peerIds) {
    lastPeerIds = peerIds || [];
    updatePttHint();
    if (!mySocketId) return;

    const want = new Set(lastPeerIds.filter((id) => id && id !== mySocketId));
    for (const id of [...peers.keys()]) {
      if (!want.has(id)) teardownPeer(id);
    }
    // Stable offerer: lexicographically smaller socket id creates the offer
    for (const id of want) {
      if (!peers.has(id)) {
        await ensurePeer(id, mySocketId < id);
      } else if (localStream) {
        // Peer already exists — make sure mic is on the sender (e.g. after approve-join)
        const needRenego = await attachLocalTracks(peers.get(id).pc);
        if (needRenego) await renegotiate(id);
      }
    }
  }

  function stopAll() {
    setTalking(false);
    for (const id of [...peers.keys()]) teardownPeer(id);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    lastError = null;
  }

  /** User-facing status after a PTT press (for toasts). */
  function statusMessage() {
    if (lastError === "insecure" || !isSecureOk()) {
      return "麦克风需要 HTTPS — 手机请用 https:// 打开（http://局域网IP 会被浏览器拦截）";
    }
    if (lastError === "denied") {
      return "麦克风权限被拒绝 — 请在浏览器设置里允许麦克风";
    }
    if (lastError === "unsupported") {
      return "此浏览器不支持麦克风";
    }
    if (lastError === "failed") {
      return "无法打开麦克风 — 请检查权限或换一个浏览器";
    }
    const n = peerCount();
    if (n === 0) {
      return "已开麦（真人声音）。房间里需要另一位真人才能听到你";
    }
    if (peers.size === 0) {
      return "语音对端未建立 — 请双方刷新页面后再试";
    }
    if (connectedCount() === 0) {
      return "正在连接语音…若一直无声，请双方刷新后再按住说话";
    }
    return null; // connected — no toast needed
  }

  function micErrorMessage(err) {
    if (lastError === "insecure" || !isSecureOk()) {
      return "麦克风需要 HTTPS — 手机请用 https:// 打开（http://局域网IP 无效）";
    }
    if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError" || lastError === "denied") {
      return "麦克风权限被拒绝 — 请允许后重试";
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return "此浏览器不支持麦克风";
    }
    return "无法打开麦克风 — 请用 HTTPS 并允许麦克风权限";
  }

  return {
    setSocketId,
    onSignal,
    syncPeers,
    setTalking,
    isTalking,
    ensureMic,
    stopAll,
    peerCount,
    connectedCount,
    statusMessage,
    micErrorMessage,
    resumeRemoteAudio,
  };
})();

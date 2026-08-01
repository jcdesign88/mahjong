/**
 * Real microphone voice chat (WebRTC) — hold-to-talk.
 * This is your actual voice, NOT text-to-speech.
 * Needs: HTTPS (or localhost), mic permission, and ≥1 other human in the room.
 */
const VoiceChat = (() => {
  const peers = new Map(); // remoteSocketId -> { pc, audio, makingOffer }
  let localStream = null;
  let mySocketId = null;
  let talking = false;
  let lastPeerIds = [];

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

  function updatePttHint() {
    const btn = document.getElementById("btn-ptt");
    if (!btn) return;
    const n = peerCount();
    btn.title =
      n > 0
        ? `按住说话 — 真人麦克风（${n} 位可听）`
        : "按住说话 — 真人麦克风（房间里需要其他真人玩家）";
    btn.dataset.peers = String(n);
  }

  async function ensureMic() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("此浏览器不支持麦克风");
    }
    if (localStream) {
      // Revive ended tracks
      const live = localStream.getAudioTracks().some((t) => t.readyState === "live");
      if (live) return localStream;
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = talking;
    });
    // Attach mic to any peers created before permission
    for (const { pc } of peers.values()) {
      const senders = pc.getSenders();
      for (const track of localStream.getAudioTracks()) {
        const sender = senders.find((s) => s.track && s.track.kind === "audio");
        if (sender) sender.replaceTrack(track);
        else pc.addTrack(track, localStream);
      }
    }
    return localStream;
  }

  function setTalking(on) {
    talking = !!on;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => {
        t.enabled = talking;
      });
    }
    const btn = document.getElementById("btn-ptt");
    if (btn) {
      btn.classList.toggle("live", talking);
      if (talking) {
        btn.textContent = peerCount() > 0 ? "说话中…" : "已开麦（无听众）";
      } else {
        btn.textContent = "按住说话";
      }
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
    const entry = { pc, audio: null, makingOffer: false };
    peers.set(remoteId, entry);

    if (localStream) {
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream);
      }
    } else {
      // Receive-only until mic granted
      pc.addTransceiver("audio", { direction: "recvonly" });
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
        audio.style.display = "none";
        document.body.appendChild(audio);
        entry.audio = audio;
      }
      const stream = ev.streams[0] || new MediaStream([ev.track]);
      audio.srcObject = stream;
      audio.play().catch(() => {
        /* autoplay may need a gesture — PTT already is one */
      });
    };

    pc.onconnectionstatechange = () => {
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
        if (entry.makingOffer) return; // glare: ignore if we are offering
        await pc.setRemoteDescription(data.sdp);
        // Upgrade to sendrecv once we have mic
        if (localStream) {
          for (const track of localStream.getAudioTracks()) {
            const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
            if (sender) await sender.replaceTrack(track);
            else pc.addTrack(track, localStream);
          }
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
        if (!entry) return;
        try {
          await entry.pc.addIceCandidate(data.candidate);
        } catch (_) {
          /* ignore early ICE */
        }
      }
    } catch (err) {
      console.warn("voice signal error", err);
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
  };
})();

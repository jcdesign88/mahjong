/**
 * Simple mesh WebRTC voice — hold-to-talk with other humans in the room.
 * Signaling goes through Socket.io.
 */
const VoiceChat = (() => {
  const peers = new Map(); // remoteSocketId -> { pc, audio }
  let localStream = null;
  let mySocketId = null;
  let roomReady = false;
  let talking = false;

  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

  function setSocketId(id) {
    mySocketId = id;
  }

  async function ensureMic() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = false;
    });
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
    if (btn) btn.classList.toggle("live", talking);
  }

  function isTalking() {
    return talking;
  }

  async function ensurePeer(remoteId, polite) {
    if (!remoteId || remoteId === mySocketId) return null;
    if (peers.has(remoteId)) return peers.get(remoteId);

    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, audio: null };
    peers.set(remoteId, entry);

    try {
      const stream = await ensureMic();
      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream);
      }
    } catch (err) {
      console.warn("Mic unavailable", err);
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        socket.emit("voice-signal", {
          to: remoteId,
          data: { type: "ice", candidate: ev.candidate },
        });
      }
    };

    pc.ontrack = (ev) => {
      let audio = entry.audio;
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.style.display = "none";
        document.body.appendChild(audio);
        entry.audio = audio;
      }
      audio.srcObject = ev.streams[0] || new MediaStream([ev.track]);
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        teardownPeer(remoteId);
      }
    };

    if (polite) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("voice-signal", {
          to: remoteId,
          data: { type: "offer", sdp: pc.localDescription },
        });
      } catch (err) {
        console.warn("voice offer failed", err);
      }
    }

    return entry;
  }

  async function onSignal({ from, data }) {
    if (!from || !data || from === mySocketId) return;
    const entry = await ensurePeer(from, false);
    if (!entry) return;
    const { pc } = entry;
    try {
      if (data.type === "offer") {
        await pc.setRemoteDescription(data.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice-signal", {
          to: from,
          data: { type: "answer", sdp: pc.localDescription },
        });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(data.sdp);
      } else if (data.type === "ice" && data.candidate) {
        await pc.addIceCandidate(data.candidate);
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

  function syncPeers(peerIds) {
    roomReady = true;
    const want = new Set((peerIds || []).filter((id) => id && id !== mySocketId));
    for (const id of peers.keys()) {
      if (!want.has(id)) teardownPeer(id);
    }
    // Lower id initiates offer to avoid glare
    for (const id of want) {
      const polite = !mySocketId || mySocketId < id;
      ensurePeer(id, polite);
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
  };
})();

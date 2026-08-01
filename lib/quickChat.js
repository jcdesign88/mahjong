/**
 * Quick table phrases — Northeast (东北) flavor.
 * Browser TTS has no real 东北口音; wording + slightly punchy rate carries the feel.
 */
const PHRASES = [
  { id: "hurry", text: "麻利点" },
  { id: "deal", text: "快出牌啊" },
  { id: "wait", text: "等会儿" },
  { id: "brb", text: "马上回来" },
  { id: "calm", text: "别催呗" },
  { id: "sorry", text: "不好意思啊" },
  { id: "thanks", text: "谢谢啊" },
];

const COOLDOWN_MS = 2500;

function getPhrase(id) {
  return PHRASES.find((p) => p.id === id) || null;
}

module.exports = { PHRASES, COOLDOWN_MS, getPhrase };

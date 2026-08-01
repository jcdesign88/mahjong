/**
 * Quick table phrases — Northeast (东北) flavor.
 * Browser TTS has no real 东北口音; wording + slightly punchy rate carries the feel.
 */
const PHRASES = [
  { id: "hurry", text: "麻利点儿行不" },
  { id: "deal", text: "别墨迹了出牌啊" },
  { id: "wait", text: "稍等哈先别催" },
  { id: "brb", text: "马上回来啊你先打" },
  { id: "calm", text: "急啥急寻思呢" },
  { id: "sorry", text: "不好意思啊刚走神了" },
  { id: "thanks", text: "谢谢老板" },
];

const COOLDOWN_MS = 2500;

function getPhrase(id) {
  return PHRASES.find((p) => p.id === id) || null;
}

module.exports = { PHRASES, COOLDOWN_MS, getPhrase };

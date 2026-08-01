/** Quick sanity checks — run with: node lib/hand.test.js */
const { isWinningHand, canPong, canChi, chiOptions } = require("./hand");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// 4 chows + pair
assert(
  isWinningHand(
    ["man1", "man2", "man3", "pin2", "pin3", "pin4", "sou5", "sou6", "sou7", "man9", "man9", "east", "east", "east"],
    0
  ),
  "standard win"
);

assert(!isWinningHand(["man1", "man2", "man3", "pin2", "pin3", "pin4", "sou5", "sou6", "sou7", "man9", "man9", "east", "south"], 0), "13 tiles no win");

assert(canPong(["red", "red", "man1"], "red"), "pong");
assert(canChi(["man1", "man2", "pin5"], "man3"), "chi");
assert(chiOptions(["man1", "man2"], "man3").length >= 1, "chi options");

console.log("hand tests passed");

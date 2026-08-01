# TABLE — Online Mahjong

Real-time 4-player mahjong. Create a room, share the link, and play in the browser.

## Rules

**Simple rules** — each player scores alone.

- Win = **4 melds + 1 pair** (平胡 / 鸡胡 OK — no minimum faan)
- Extra faan from patterns (對對胡, 混一色, dragons…) still boost payout: `2^faan`
- **食糊** (win on discard): discarder pays all
- **自摸** (self-draw): all three opponents pay (winner gets 1.5× base)

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Open [http://localhost:3847](http://localhost:3847).

1. Create a room and copy the invite link
2. Friends join (or fill empty seats with bots)
3. Ready → host starts
4. Highest individual score after 4 rounds wins

## Stack

- Node.js + Express + Socket.io
- Vanilla HTML / CSS / JS client

Tile face art includes public-domain riichi tile references where used; bamboo sticks are drawn in Chinese style.

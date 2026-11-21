# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/munchroot/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/munchroot/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a dashboard that ranks the protocols whose token does not exist yet by what that token would be worth if it launched at the snapshot's record - and shows, for each one, the concrete steps to farm it before it does.

## The model (comps-2)

No hand-picked multiples and no hardcoded names. The snapshot itself contains the market's answer for protocols that already launched: market cap / TVL. The model

1. reads that ratio off every launched protocol in the snapshot with a real market cap (128 of them on the 2026-11-14 snapshot),
2. takes the **median per category**, trusted only when a category has at least 5 launched peers - otherwise the **global median (x0.214)** applies,
3. caps every multiple at **x3.0** so one absurd peer cannot price a category,
4. adjusts each protocol by its own record: 7-day TVL growth (clamped to -60%..+120%, weight 0.5), maturity (how long it has run with no token, full credit at 3 years, unknown listing dates scored at 1 year), and reach (+2% per extra chain, up to 5).

`implied = TVL x category multiple x growth x maturity x reach`, reproducible from the snapshot alone. The board ranks **every clean pre-token candidate** (the same cleanliness the snapshot's watchlist applies: no versioned pools, no wrapped / staked / bridged products, no exchange house brands) - 198 protocols on this snapshot, the 40-protocol watchlist included. Protocols whose record carries a token symbol or a CoinGecko id already have a token and are never ranked; the largest of them are shown on the dashboard's calibration view with the multiple the market actually pays.

Every board row carries a farm plan generated from the protocol's own record: its category's playbook, its real chains and their gas class, a position size from its TVL tier, and a seasoning window from its age - each step with a cost and a time.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22.18+, standard library only, no install. Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. `node tools/verify.ts` re-checks the model and the board against the gate's rules locally.

## Layout

- `main.ts` - the entry program: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` - the model: calibration, implied value, farm plans, gate self-check.
- `dashboard/` - the static page (no framework, no network).
- `screenshots/` - the board, a detail view and a filtered view of the page.
- `vendor/makefun-board.ts` - make.fun's dossier library, vendored as instructed.

## License

MIT - see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

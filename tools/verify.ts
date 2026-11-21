// Local verification for the radar model, run against the kit's sealed snapshot:
//   node tools/verify.ts [path-to-snapshot.json]
// Prints the calibration table, the board's head, and every gate self-check result.

import { readFileSync } from 'node:fs';
import { boardIssue, buildRadar, calibrate, parseSnapshot } from '../lib/model.ts';

const file = process.argv[2] ?? new URL('../../token-radar-01-kit/input/snapshot.json', import.meta.url).pathname;
const snapshot = parseSnapshot(readFileSync(file, 'utf8'));
const calib = calibrate(snapshot);
const { board, radar } = buildRadar(snapshot);

console.log(`snapshot: ${snapshot.protocols.length} protocols, as_of ${snapshot.as_of}, watchlist ${snapshot.watchlist.length}`);
console.log(`calibration: ${calib.tokenised_count} launched protocols with mcap > 0, global median x${calib.global_median}`);
for (const c of calib.categories.filter((c) => c.sample >= 3)) {
  console.log(`  ${c.category.padEnd(28)} n=${String(c.sample).padStart(2)} median x${c.median_multiple} -> applied x${c.applied_multiple} (${c.source})`);
}
console.log(`board: ${board.length} rows`);
for (const r of board.slice(0, 10)) {
  console.log(`  #${r.rank} ${r.name} (${r.category ?? '-'}) TVL $${(r.tvl_usd / 1e6).toFixed(1)}M -> implied $${(r.implied_value_usd / 1e6).toFixed(1)}M [x${r.model.base_multiple} ${r.model.multiple_source}, g x${r.model.growth_multiplier}, m x${r.model.maturity_multiplier}, c x${r.model.chain_multiplier}]`);
}
const lens = board.flatMap((r) => r.farm_steps.map((s) => s.trim().length));
console.log(`farm steps: ${lens.length} steps, min ${Math.min(...lens)} chars, max ${Math.max(...lens)} chars`);
console.log(`radar data: board_size ${radar.board_size}, live_size ${radar.live_size}, data.js would carry ${radar.rows.length} rows`);
const issue = boardIssue(board, snapshot);
console.log(issue === null ? 'boardIssue: PASS (gate self-check clean)' : `boardIssue: FAIL - ${issue}`);
if (issue !== null) process.exit(1);

// Token launch radar, model v2 ("comps-calibrated").
//
// The idea: a pre-token protocol's implied launch value should not come from a single
// hand-picked multiple. The sealed snapshot already contains the market's own answer
// for protocols that did launch: their market cap divided by their TVL. This model
// reads those ratios off the snapshot's tokenised protocols, takes the median per
// category, and applies that category median to the pre-token protocols in the same
// category. Categories with too few launched peers fall back to the global median,
// and every multiple is capped, so one absurd peer can never price a whole category.
//
// On top of the comps base, three adjustments, all from the protocol's own record:
//   growth    - the 7-day TVL change, clamped, moves the value by at most -30%/+60%;
//   maturity  - the longer a protocol has run with no token, the closer its multiple
//               gets to the full comps figure (a young protocol is discounted);
//   reach     - each extra chain beyond the first adds a small distribution bonus.
//
// Nothing here is a hardcoded list of names: give the model a different snapshot and
// every multiple, rank and plan is recomputed from that snapshot alone.

/** One protocol record, exactly the fields the sealed snapshot carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot: a frozen DefiLlama pull, its floor and its watchlist. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the board rows carry it. */
export const MODEL_VERSION = 'comps-2';

/** A category needs at least this many launched peers before its own median is trusted. */
export const MIN_CATEGORY_SAMPLE = 5;
/** No category multiple, however hot its peers, prices a protocol past this ratio. */
export const MULTIPLE_CAP = 3.0;
/** The 7-day TVL change is clamped to this band before it moves the value. */
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;
/** How much of the clamped growth reaches the value: 0.5 turns +120% into x1.6. */
export const GROWTH_WEIGHT = 0.5;
/** A brand-new protocol keeps this share of its comps value... */
export const MATURITY_FLOOR = 0.6;
/** ...and earns the rest linearly over this many days running with no token. */
export const MATURITY_RANGE = 0.4;
export const MATURITY_DAYS = 1095;
/** Protocols whose listing date the snapshot does not carry are scored at this age. */
export const UNKNOWN_AGE_DAYS = 365;
/** Distribution bonus per extra chain, and how many extra chains can earn it. */
export const CHAIN_BONUS = 0.02;
export const CHAIN_BONUS_STEPS = 5;

/** One category's comps: how many launched peers it has and the multiple they imply. */
export interface CategoryComp {
  category: string;
  sample: number;
  median_multiple: number | null;
  /** The multiple actually applied: the category median, or the global fallback. */
  applied_multiple: number;
  source: 'category' | 'global';
}

/** The whole calibration read off one snapshot: a global median plus per-category comps. */
export interface Calibration {
  global_median: number;
  tokenised_count: number;
  categories: CategoryComp[];
  byCategory: Map<string, CategoryComp>;
}

/** A farm step before it is flattened: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked claim, the figures behind it, and the farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  model_version: string;
  model: {
    base_multiple: number;
    multiple_source: 'category' | 'global';
    category_sample: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
  };
  farm_steps: string[];
}

/** A board row's compact form for the dashboard's data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  multiple_source: 'category' | 'global';
  category_sample: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

/** A protocol that already trades: the market's own value, shown as calibration evidence. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** Everything the dashboard renders: the board, the calibration, and the model stated. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  constants: {
    min_category_sample: number;
    multiple_cap: number;
    growth_floor: number;
    growth_cap: number;
    growth_weight: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    chain_bonus: number;
  };
  global_median: number;
  tokenised_count: number;
  categories: CategoryComp[];
  watchlist_size: number;
  board_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list: the middle value, or the mean of the two middle ones. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to the snapshot's `asOf`, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Whether a protocol records no token: neither a CoinGecko id nor a symbol. A market
 * cap of zero (or the snapshot's one negative glitch) is a data state, not a launch;
 * what decides is whether a token identity exists at all.
 */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories whose product is itself a token or an exchange: never launch candidates. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that mark a wrapped or staked product of an asset that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's brand are that exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a pre-token protocol is a clean launch candidate the board may rank: the
 * same cleanliness the snapshot's own watchlist applies (no versioned pools, no
 * wrapped/staked/bridged products, no exchange house brands), at any TVL.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((brand) => p.name.startsWith(brand))) return false;
  return true;
}

/**
 * Read the calibration off the snapshot: every protocol with a real market cap
 * (mcap > 0; zero and the one negative record carry no pricing information) gives
 * one mcap/TVL ratio. The global median is the fallback; a category median is
 * trusted only at MIN_CATEGORY_SAMPLE peers or more.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratios: number[] = [];
  const byCat = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = ratios.length > 0 ? median(ratios) : 0;
  const categories: CategoryComp[] = [...byCat.entries()]
    .map(([category, list]) => {
      const med = median(list);
      const trusted = list.length >= MIN_CATEGORY_SAMPLE;
      return {
        category,
        sample: list.length,
        median_multiple: round4(med),
        applied_multiple: round4(Math.min(trusted ? med : globalMedian, MULTIPLE_CAP)),
        source: trusted ? ('category' as const) : ('global' as const),
      };
    })
    .sort((a, b) => b.sample - a.sample || (a.category < b.category ? -1 : 1));
  const byCategory = new Map(categories.map((c) => [c.category, c]));
  return { global_median: round4(globalMedian), tokenised_count: ratios.length, categories, byCategory };
}

/** The multiple one protocol is priced at, and where that multiple came from. */
function multipleFor(p: SnapshotProtocol, calib: Calibration): { multiple: number; source: 'category' | 'global'; sample: number } {
  const comp = p.category === null ? undefined : calib.byCategory.get(p.category);
  if (comp !== undefined && comp.source === 'category') {
    return { multiple: comp.applied_multiple, source: 'category', sample: comp.sample };
  }
  return { multiple: Math.min(calib.global_median, MULTIPLE_CAP), source: 'global', sample: comp?.sample ?? 0 };
}

/** One protocol's implied launch value and every factor that produced it. */
export function impliedValue(
  p: SnapshotProtocol,
  calib: Calibration,
  asOf: string,
): { implied: number; baseMultiple: number; source: 'category' | 'global'; sample: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const { multiple, source, sample } = multipleFor(p, calib);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = p.change_7d ?? 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const chainMult = 1 + CHAIN_BONUS * Math.min(Math.max(p.chains.length - 1, 0), CHAIN_BONUS_STEPS);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, baseMultiple: multiple, source, sample, growthPct, growthMult, maturityMult, chainMult, age };
}

/** A step as one string: the action, then its cost and its time, kept inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Keep the position open and re-check it weekly.`;
  return s;
}

/** Rough gas for one transaction on a chain: mainnet is dear, L2s and alt-L1s are not. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Taiko', 'Manta'].includes(chain)) return 1.5;
  if (['Solana', 'BSC', 'Avalanche', 'Polygon', 'Fantom', 'Sui', 'Aptos', 'Near', 'Tron'].includes(chain)) return 0.8;
  return 3;
}

/** The chain to lead with, and up to two more the protocol also runs on, for the plan's wording. */
function chainNames(p: SnapshotProtocol): { first: string; others: string } {
  const first = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const rest = p.chains.slice(1, 3);
  return { first, others: rest.length > 0 ? rest.join(' and ') : '' };
}

/** Position size by the protocol's own TVL tier: big protocols absorb more, small ones need less. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 50;
}

/** How long a position should season: younger protocols get the longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 30;
  return 21;
}

/** The core farming action for a category group, in words a farmer can follow. */
function coreAction(group: string, name: string, chain: string, capital: number): string {
  switch (group) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain}; if it offers borrowing, borrow about 40% against it and re-supply the loan once, then leave both legs untouched.`;
    case 'dex':
      return `Add $${capital} of liquidity to ${name}'s busiest stable or blue-chip pool on ${chain}, split evenly between the two assets, and keep the position in range.`;
    case 'yield':
      return `Deposit $${capital} of USDC into ${name}'s main vault on ${chain} and keep the vault shares in the same wallet that deposited them.`;
    case 'curator':
      return `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain} (pick the vault with the most deposits) and keep the shares unmoved.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name}, open one small position hedged with an equal spot holding elsewhere, and roll it once a week.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} with USDC and hold the minted asset in the farming wallet.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}, then park it in the protocol's own savings or staking vault if one exists.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active for the full term.`;
    case 'prediction':
      return `Fund $${capital} on ${name} and take one position in its most liquid market, sized so a total loss is acceptable.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} through its main app flow and keep the resulting position open.`;
  }
}

/** Which playbook a category follows, by keyword on the category name. */
function groupFor(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('swap')) return 'dex';
  if (c.includes('curator') || c.includes('allocator')) return 'curator';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'perps';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  return 'generic';
}

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time, built
 * from the protocol's own record - its category's playbook, its real chains and
 * their gas class, its TVL tier's position size, its age's seasoning window.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const { first, others } = chainNames(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(first);
  const group = groupFor(p.category);
  const secondChainLine = others !== '' ? ` Repeat the core action once on ${others} if the protocol counts cross-chain activity; a second chain roughly doubles the gas line below.` : '';
  return [
    {
      text: `Set up one fresh wallet for ${p.name} alone, back up its seed phrase on paper, and fund it on ${first} with the position money plus a gas buffer.`,
      cost: `about $${gas} of gas to make the wallet's first transaction`,
      time: '10 minutes, once',
    },
    {
      text: coreAction(group, p.name, first, capital),
      cost: `$${capital} of capital in the position and about $${gas * 2} of gas for the entry transactions`,
      time: '20 minutes to set up',
    },
    {
      text: `Add a second, different kind of activity so the wallet does not look one-dimensional: a small swap, a partial withdraw-and-redeposit, or a governance vote if ${p.name} runs one.${secondChainLine}`,
      cost: 'about $2 of gas per extra action',
      time: '10 minutes, in the first week',
    },
    {
      text: `Keep the position open for at least ${hold} days and make one small qualifying action each week (a deposit top-up, a borrow adjust, or a claim of accrued rewards) so the wallet shows up in several weekly snapshots.`,
      cost: `the $${capital} stays deployed; about $${gas} of gas a week`,
      time: `${hold} days, 10 minutes a week`,
    },
    {
      text: `Every Friday, open ${p.name}'s official points or rewards page (only from the link in its own app, never from a search ad or a DM) and screenshot the balance into a farm log with the wallet address and dates; exit only after a snapshot or season end the protocol has announced.`,
      cost: 'nothing to check; never pay anyone a fee to "unlock" a claim',
      time: '5 minutes a week',
    },
  ];
}

/** The board: every clean pre-token candidate in the snapshot, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, calib: Calibration = calibrate(snapshot)): BoardRow[] {
  const pool = snapshot.protocols.filter(isRankable);
  const scored = pool.map((p) => ({ p, v: impliedValue(p, calib, snapshot.as_of) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model_version: MODEL_VERSION,
    model: {
      base_multiple: s.v.baseMultiple,
      multiple_source: s.v.source,
      category_sample: s.v.sample,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The largest already-trading protocols, with the multiple the market actually pays. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: round4(p.mcap_usd! / p.tvl_usd),
    }));
}

/** A board row's compact form for data.js: everything the page renders, farm plan included. */
function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    multiple_source: row.model.multiple_source,
    category_sample: row.model.category_sample,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    on_watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const calib = calibrate(snapshot);
  const board = buildBoard(snapshot, calib);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    constants: {
      min_category_sample: MIN_CATEGORY_SAMPLE,
      multiple_cap: MULTIPLE_CAP,
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      growth_weight: GROWTH_WEIGHT,
      maturity_floor: MATURITY_FLOOR,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      chain_bonus: CHAIN_BONUS,
    },
    global_median: calib.global_median,
    tokenised_count: calib.tokenised_count,
    categories: calib.categories,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/**
 * Why a board is not one the gate will take, or null. Mirrors the gate's own rows:
 * 100..4000 rows, every slug a real snapshot protocol, watchlist fully covered,
 * ranks exactly 1..N, implied value never rising with rank, not all values equal,
 * every farm plan 3..12 steps of 20..600 characters.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value: not a ranking';
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

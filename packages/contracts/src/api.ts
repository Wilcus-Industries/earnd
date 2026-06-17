/**
 * The client <-> server API contract. Both the Go banner client and the Next.js
 * server are written against these shapes. Surfaces (shell/tmux/vim) all use the
 * same impression lifecycle: begin -> heartbeat -> redeem.
 */

/** Which rendering surface is showing the banner. */
export type Surface = "shell" | "tmux" | "vim";

/**
 * The ad creative shown in the banner. Mirrors the product's JSON schema; `line`
 * and `url` are sanitized server-side before they ever reach a terminal.
 */
export interface Creative {
  /** Stable id for impression/click attribution. */
  adId: string;
  /** The banner text (already sanitized: no control/escape bytes). */
  line: string;
  /** Display URL shown to the user (e.g. "earnd.net"). Not the click target. */
  displayUrl: string;
  /** The signed click redirect the banner actually points at: `${base}/r/<token>`. */
  clickUrl: string;
  /** Optional small base64 icon (validated server-side). */
  icon?: string | null;
}

// ── POST /api/impression/begin ──────────────────────────────────────
export interface ImpressionBeginRequest {
  deviceId: string;
  surface: Surface;
  /** Terminal width in columns, so the server can pre-truncate if desired. */
  width: number;
  /** Unix ms client timestamp (advisory only; server time is authoritative). */
  clientTime: number;
}

export interface ImpressionBeginResponse {
  /** No eligible/funded ad right now — client shows nothing. */
  empty?: boolean;
  creative?: Creative;
  /** Opaque server-signed, single-use token gating this impression. */
  impressionToken?: string;
  /** Seconds of continuous display required before redeem is accepted. */
  minDwellSeconds?: number;
  /** Authoritative server time (unix ms) for client clock-skew correction. */
  serverTime: number;
}

// ── POST /api/impression/heartbeat ──────────────────────────────────
export interface ImpressionHeartbeatRequest {
  impressionToken: string;
  /** Cumulative seconds the banner has been continuously displayed. */
  displayedSeconds: number;
}

export interface ImpressionHeartbeatResponse {
  /** Server tells client to keep displaying / whether it may redeem yet. */
  redeemable: boolean;
  /** If false, client should re-`begin` (e.g. token expired / ad changed). */
  ok: boolean;
}

// ── POST /api/impression/redeem ─────────────────────────────────────
export interface ImpressionRedeemRequest {
  impressionToken: string;
  displayedSeconds: number;
}

export interface ImpressionRedeemResponse {
  /** True if the impression was recorded + billed. */
  recorded: boolean;
  /** Reason when not recorded (dwell_unmet | rate_exceeded | expired | flagged | replay). */
  reason?: string;
  /** Optional next token so the client can roll into a fresh auction without a round-trip. */
  nextToken?: string;
}

// ── GET /api/market ─────────────────────────────────────────────────
export interface MarketLeaderRow {
  rank: number;
  advertiser: string;
  /** Current CPM bid in millicents (aggregated/rounded for public display). */
  cpmMillicents: number;
  line: string;
  /** Lifetime spend in millicents. */
  spendMillicents: number;
}

export interface MarketSeriesPoint {
  /** Unix ms bucket timestamp. */
  t: number;
  /** Winning/clearing CPM in millicents at this bucket. */
  cpmMillicents: number;
}

export interface MarketSeries {
  advertiser: string;
  points: MarketSeriesPoint[];
}

export interface MarketSnapshot {
  /** Slightly delayed to deter sniping. */
  asOf: number;
  impressionsPerMinute: number;
  liveCampaigns: number;
  /**
   * Residual invalid-traffic rate over the trailing 24h: held (SIVT/GIVT) divided
   * by total recorded impressions, in [0,1]. Published for advertiser transparency
   * (IAB/MRC norm) — only validated impressions are billed.
   */
  ivtRate: number;
  leaderboard: MarketLeaderRow[];
  series: MarketSeries[];
}

/**
 * Share links — types and the pure predicates.
 *
 * Split from the network calls on purpose, following this repo's own
 * convention: a lib module that imports `./api` at runtime drags in
 * AsyncStorage and cannot be unit-tested (jest-expo has no native
 * module for it, and there is no setup file mocking one). Compare
 * clinical-passport-pdf.ts, which reaches for `import type` only.
 *
 * So everything worth asserting lives here, and passport-share-api.ts
 * stays a thin wrapper with nothing in it to get wrong.
 *
 * See db/migrations/021_passport_share_links.sql for what a share is
 * and what it is careful about.
 */

/**
 * The pickup half of a share, when the patient handed the record over
 * in person instead of forwarding a URL.
 *
 * See db/migrations/024_passport_pickup_codes.sql. `attempts` is here
 * because the patient is entitled to know that someone typed the wrong
 * birthdate against their code twice, and `burnedAt` is here because
 * otherwise a code that stopped working has no explanation.
 */
export type PassportSharePickup = {
  expiresAt: string;
  attempts: number;
  redeemedAt: string | null;
  burnedAt: string | null;
};

export type PassportShare = {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  openedCount: number;
  lastOpenedAt: string | null;
  /** Non-null when this row is a pickup code rather than a URL link.
   *  Both are doors and belong in the same list; they are not the same
   *  thing on screen. */
  pickup: PassportSharePickup | null;
  /** Present ONLY on the create response. */
  token?: string;
  /** Present ONLY on the create-pickup response. Same rule as `token`:
   *  the server keeps a digest and cannot reissue it. */
  code?: string;
};

/** How many wrong birthdates burn a code. Mirrors MAX_PICKUP_ATTEMPTS
 *  in the API service — stated here so the screen can say the number
 *  out loud rather than leaving the patient to find out. */
export const PICKUP_MAX_ATTEMPTS = 3;

/**
 * The URL a patient forwards.
 *
 * Takes the origin rather than reading `window.location`: the same
 * bundle is served from a domain, an IP and a dev machine, so the
 * public host is not knowable at build time — and a pure module that
 * reaches for a global is both untestable under jest-expo (which has
 * no DOM) and wrong on native, where there is no origin at all.
 *
 * Returns null for anything that is not an http(s) origin. A link with
 * the wrong host is worse than no link: the patient sends it, the
 * clinician gets nothing, and neither of them can tell why — so the
 * caller shows the token with an explanation instead.
 */
export const buildShareUrl = (token: string, origin: string | null | undefined): string | null => {
  if (!token || !origin) return null;
  if (!/^https?:\/\/[^/]+$/.test(origin)) return null;
  return `${origin}/s/passport/${token}`;
};

/** Live means: not revoked, and not past its expiry. Both halves — a
 *  revoked link that has not expired yet still opens nothing, and an
 *  expired one that was never revoked is equally dead. */
export const isShareLive = (share: PassportShare, now = new Date()): boolean => {
  if (share.revokedAt) return false;
  const expires = new Date(share.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
};

/** 「还有 3 天」 rather than a timestamp: the question a patient is
 *  actually asking of this list is whether the link they gave their
 *  doctor last week still works. */
export const describeShareLife = (share: PassportShare, now = new Date()): string => {
  if (share.revokedAt) return '已撤销';
  const expires = new Date(share.expiresAt);
  if (Number.isNaN(expires.getTime())) return '有效期未知';
  const ms = expires.getTime() - now.getTime();
  if (ms <= 0) return '已过期';
  // Minutes and hours before days.
  //
  // 「不到 1 天后过期」 was fine for a seven-day link in its last hours
  // and is a lie about a pickup code, which lives fifteen minutes: a
  // patient standing in a consulting room reading 「不到 1 天后过期」
  // has no idea they have four minutes left. The link case gets the
  // same improvement for free — an hour is an hour either way.
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 60) return `约 ${minutes} 分钟后过期`;
  const hours = Math.ceil(ms / 3_600_000);
  if (hours <= 24) return `约 ${hours} 小时后过期`;
  return `${Math.ceil(ms / 86_400_000)} 天后过期`;
};

/**
 * The one line under a pickup row.
 *
 * Ordered by what has actually happened, not by severity: a code that
 * was used is done, whatever its clock says, and a burned code needs
 * to say WHY it stopped working or the patient reasonably concludes
 * the feature is broken.
 */
export const describePickupState = (share: PassportShare, now = new Date()): string | null => {
  const pickup = share.pickup;
  if (!pickup) return null;
  if (pickup.redeemedAt) return '已被医生取走一次 · 取件码是一次性的，已失效';
  if (pickup.burnedAt) return `出生日期输错 ${PICKUP_MAX_ATTEMPTS} 次，取件码已作废`;
  if (share.revokedAt) return '已撤销';
  const expires = new Date(pickup.expiresAt);
  if (Number.isNaN(expires.getTime())) return '有效期未知';
  const ms = expires.getTime() - now.getTime();
  if (ms <= 0) return '已过期';
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const wrong =
    pickup.attempts > 0
      ? ` · 有人输错过 ${pickup.attempts} 次，再错 ${PICKUP_MAX_ATTEMPTS - pickup.attempts} 次就作废`
      : '';
  return `还能用约 ${minutes} 分钟${wrong}`;
};

/** A pickup code is live only while it has not been used, burned,
 *  revoked or expired. All four, because any one of them is enough. */
export const isPickupLive = (share: PassportShare, now = new Date()): boolean => {
  const pickup = share.pickup;
  if (!pickup) return false;
  if (pickup.redeemedAt || pickup.burnedAt || share.revokedAt) return false;
  const expires = new Date(pickup.expiresAt);
  if (Number.isNaN(expires.getTime())) return false;
  return expires.getTime() > now.getTime();
};

/**
 * The page the doctor lands on after scanning. NOT a URL carrying the
 * code.
 *
 * A URL with the code in it would put a live credential in the
 * doctor's history, in the hospital's proxy log and in the Referer of
 * whatever they open next — and it would collapse a two-factor
 * handover into a link anyone who photographed the patient's screen
 * could replay. The QR saves the typing that hurts; the eight
 * characters stay spoken.
 */
export const buildPickupUrl = (origin: string | null | undefined): string | null => {
  if (!origin) return null;
  if (!/^https?:\/\/[^/]+$/.test(origin)) return null;
  return `${origin}/s/passport/pickup`;
};

/** 「K7F3-9QTM」. Two groups of four, because that is how a person reads
 *  eight characters out loud without losing their place. Mirrors
 *  formatPickupCode in the API service. */
export const formatPickupCode = (code: string): string =>
  code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

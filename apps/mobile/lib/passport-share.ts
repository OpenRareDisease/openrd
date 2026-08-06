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

export type PassportShare = {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  openedCount: number;
  lastOpenedAt: string | null;
  /** Present ONLY on the create response. */
  token?: string;
};

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
  const days = Math.ceil(ms / 86_400_000);
  return days <= 1 ? '不到 1 天后过期' : `${days} 天后过期`;
};

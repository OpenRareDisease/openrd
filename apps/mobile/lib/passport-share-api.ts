import { apiRequest } from './api';
import type { PassportShare } from './passport-share';

/**
 * The three network calls for share links.
 *
 * THE ENVELOPE IS NOT OPTIONAL.
 *
 * `apiRequest` returns the parsed body verbatim — it does NOT unwrap
 * `{ data: ... }` (lib/api.ts, `return payload as T`) — and its type
 * parameter is an unchecked assertion, so writing
 * `apiRequest<PassportShare[]>(...)` typechecks, passes every test, and
 * is wrong at runtime. It was, here, and the way it failed is the
 * reason this comment is this long:
 *
 *   - `list` handed back `{ data: [...] }`, so `shares.length` was
 *     `undefined` and the section rendered blank — telling a patient
 *     who had shared their record last week that they never had.
 *   - `create` handed back `{ data: {token} }`, so `link.token` was
 *     undefined, the 「链接已生成」 block never rendered, and the patient
 *     saw nothing happen and pressed again. Each press mints a real,
 *     live, read-only credential to their medical record that the
 *     server cannot reissue and the blank list could not show them —
 *     up to MAX_LIVE_SHARES invisible doors they had no way to revoke.
 *
 * So every response is unwrapped and shape-checked here, and
 * passport-share-api.test.ts asserts against actual response bodies.
 * A generic alone proves nothing.
 */

/** Pull `data` out of the API envelope. Tolerates a bare body so the
 *  client does not break if a route is ever changed to return one. */
const unwrap = (payload: unknown): unknown => {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: unknown }).data;
  }
  return payload;
};

/**
 * The pickup half, shape-checked the same way and for the same reason.
 *
 * `expiresAt` is the gate: without a usable expiry there is no way to
 * tell the patient how long the code has left, and a pickup row shown
 * without its clock is worse than not showing it — fifteen minutes is
 * short enough that 「还能用」 with no number is just wrong.
 */
const asPickup = (raw: unknown): PassportShare['pickup'] => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.expiresAt !== 'string') return null;
  return {
    expiresAt: record.expiresAt,
    attempts: Number.isFinite(record.attempts) ? Number(record.attempts) : 0,
    redeemedAt: typeof record.redeemedAt === 'string' ? record.redeemedAt : null,
    burnedAt: typeof record.burnedAt === 'string' ? record.burnedAt : null,
  };
};

const asShare = (raw: unknown): PassportShare | null => {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.expiresAt !== 'string') return null;
  return {
    id: record.id,
    label: typeof record.label === 'string' ? record.label : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    expiresAt: record.expiresAt,
    revokedAt: typeof record.revokedAt === 'string' ? record.revokedAt : null,
    openedCount: Number.isFinite(record.openedCount) ? Number(record.openedCount) : 0,
    lastOpenedAt: typeof record.lastOpenedAt === 'string' ? record.lastOpenedAt : null,
    pickup: asPickup(record.pickup),
    ...(typeof record.token === 'string' ? { token: record.token } : {}),
    ...(typeof record.code === 'string' ? { code: record.code } : {}),
  };
};

export const listPassportShares = async (): Promise<PassportShare[]> => {
  const data = unwrap(await apiRequest<unknown>('/passport-shares'));
  if (!Array.isArray(data)) return [];
  return data.map(asShare).filter((share): share is PassportShare => share !== null);
};

/**
 * Mint a link. Throws when the response does not carry a token, rather
 * than resolving with nothing: the server has already issued a live
 * credential at that point, and a silent success is what let a patient
 * press the button five times.
 */
export const createPassportShare = async (
  input: { label?: string; days?: number } = {},
): Promise<PassportShare & { token: string }> => {
  const data = unwrap(
    await apiRequest<unknown>('/passport-shares', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
  const share = asShare(data);
  if (!share?.token) {
    throw new Error(
      '服务器没有返回链接内容，请重试；如果反复失败，请到「隐私设置」查看是否已经生成过。',
    );
  }
  return share as PassportShare & { token: string };
};

/**
 * A whole positive count from the response envelope, or null.
 *
 * Same discipline as `asPickup`: the value crosses the wire, so its
 * type is a claim until something checks it. null rather than a
 * fallback number, because the caller's job is to say 「不知道」 rather
 * than to state a duration nothing told it — a screen that asserts
 * fifteen minutes it has no evidence for is the exact failure this
 * repo keeps shipping.
 */
const asCount = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && Number.isInteger(raw) ? raw : null;

/** What the server said about the code it just minted. `ttlMinutes` and
 *  `maxAttempts` ride OUTSIDE the `data` envelope, so they survive only
 *  if they are read before it is unwrapped. */
export type CreatedPickup = {
  share: PassportShare & { code: string; pickup: NonNullable<PassportShare['pickup']> };
  /** The server's own PICKUP_TTL_MINUTES, or null when the response did
   *  not carry a usable one. Never substituted with a guess. */
  ttlMinutes: number | null;
  /** The server's own MAX_PICKUP_ATTEMPTS, or null. Same rule. */
  maxAttempts: number | null;
};

/**
 * Mint a pickup code. Throws when the response carries no code, for
 * exactly the reason `createPassportShare` does: by the time this
 * resolves the server has already opened a door, and a silent success
 * is what let a patient press a button five times and mint five live
 * credentials they could not see.
 *
 * The `pickup` block is required too, not just the code. A code with
 * no expiry on screen is a code the patient cannot tell is dead, and
 * fifteen minutes is short enough that they will find out in front of
 * the doctor.
 */
export const createPassportPickup = async (
  input: { label?: string } = {},
): Promise<CreatedPickup> => {
  const payload = await apiRequest<unknown>('/passport-shares/pickup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const envelope = (payload && typeof payload === 'object' ? payload : {}) as Record<
    string,
    unknown
  >;
  const share = asShare(unwrap(payload));
  if (!share?.code || !share.pickup) {
    throw new Error(
      '服务器没有返回取件码，请重试；如果反复失败，请到「隐私设置」查看是否已经生成过。',
    );
  }
  return {
    share: share as PassportShare & {
      code: string;
      pickup: NonNullable<PassportShare['pickup']>;
    },
    ttlMinutes: asCount(envelope.ttlMinutes),
    maxAttempts: asCount(envelope.maxAttempts),
  };
};

export const revokePassportShare = async (id: string): Promise<void> => {
  await apiRequest<unknown>(`/passport-shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

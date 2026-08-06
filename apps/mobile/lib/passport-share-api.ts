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
    ...(typeof record.token === 'string' ? { token: record.token } : {}),
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

export const revokePassportShare = async (id: string): Promise<void> => {
  await apiRequest<unknown>(`/passport-shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

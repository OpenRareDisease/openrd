import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SHARE_DAYS,
  digestsMatch,
  MAX_LIVE_SHARES,
  MAX_SHARE_DAYS,
  PassportShareService,
  ShareLimitReachedError,
} from './passport-share.service.js';
import type { AppLogger } from '../../config/logger.js';

/**
 * A share link publishes a medical record to whoever holds the URL.
 * That is the feature and it is also the risk, so the invariants below
 * are the feature — a link that outlives its revocation, or a token
 * recoverable from a database dump, is not a smaller version of this
 * capability. It is a leak.
 */

const logger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
} as unknown as AppLogger;

type Call = { sql: string; params: unknown[] };

const makePool = (responses: Array<{ rows: unknown[]; rowCount?: number }>) => {
  const calls: Call[] = [];
  let i = 0;
  const pool = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const next = responses[i++] ?? { rows: [] };
      return { rows: next.rows, rowCount: next.rowCount ?? next.rows.length };
    }),
  };
  return { pool: pool as never, calls };
};

const row = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  label: null,
  created_at: new Date('2026-08-05T00:00:00Z'),
  expires_at: new Date('2026-08-12T00:00:00Z'),
  revoked_at: null,
  opened_count: 0,
  last_opened_at: null,
  ...over,
});

describe('明文 token 只在创建那一次存在', () => {
  it('落库的是 sha256，不是 token 本身', async () => {
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    const link = await new PassportShareService(pool, logger).create('u1');

    expect(link.token).toBeTruthy();
    const insert = calls.find((c) => c.sql.includes('INSERT INTO passport_share_links'));
    const stored = String(insert?.params[1]);
    // The hash is stored...
    expect(stored).toBe(createHash('sha256').update(link.token!, 'utf8').digest('hex'));
    // ...and the token itself appears in no parameter of any statement.
    const everyParam = JSON.stringify(calls.map((c) => c.params));
    expect(everyParam).not.toContain(link.token);
  });

  it('审计行不写 token —— 那等于把可用链接再存一份', async () => {
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    const link = await new PassportShareService(pool, logger).create('u1');
    const audit = calls.find((c) => c.sql.includes('audit_logs'));
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit?.params)).not.toContain(link.token);
    expect(JSON.stringify(audit?.params)).toContain('shareId');
  });

  it('列表和撤销都不回传 token', async () => {
    const { pool } = makePool([{ rows: [row()] }]);
    const [listed] = await new PassportShareService(pool, logger).list('u1');
    expect(listed.token).toBeUndefined();
  });
});

describe('有效期是必须的，且有上限', () => {
  it('不传天数时用默认值', async () => {
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    await new PassportShareService(pool, logger).create('u1');
    const insert = calls.find((c) => c.sql.includes('INSERT INTO passport_share_links'));
    expect(insert?.params[3]).toBe(String(DEFAULT_SHARE_DAYS));
  });

  it('超过上限的天数被夹紧，而不是被拒绝', async () => {
    // Rejecting teaches the patient nothing; the response carries the
    // real expiry and the UI states it.
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    await new PassportShareService(pool, logger).create('u1', { days: 3650 });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO passport_share_links'));
    expect(insert?.params[3]).toBe(String(MAX_SHARE_DAYS));
  });

  it('0 天或负数被抬到 1 天，不会生成一个已经过期的链接', async () => {
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    await new PassportShareService(pool, logger).create('u1', { days: -5 });
    const insert = calls.find((c) => c.sql.includes('INSERT INTO passport_share_links'));
    expect(insert?.params[3]).toBe('1');
  });

  it('活跃链接数到上限时拒绝新建', async () => {
    const { pool } = makePool([{ rows: [{ n: MAX_LIVE_SHARES }] }]);
    await expect(new PassportShareService(pool, logger).create('u1')).rejects.toBeInstanceOf(
      ShareLimitReachedError,
    );
  });
});

describe('解析必须在同一条语句里判过期和撤销', () => {
  it('过期与撤销的条件写在 UPDATE 的 WHERE 里', async () => {
    // Two queries — read then check — leaves a window where a link
    // revoked in between still resolves. One statement has no window.
    const { pool, calls } = makePool([{ rows: [] }]);
    await new PassportShareService(pool, logger).resolve('x'.repeat(43));
    const sql = calls[0].sql;
    expect(sql).toContain('UPDATE passport_share_links');
    expect(sql).toContain('revoked_at IS NULL');
    expect(sql).toContain('expires_at > NOW()');
  });

  it('查不到就是 null —— 过期、撤销、不存在不做区分', async () => {
    const { pool } = makePool([{ rows: [] }]);
    expect(await new PassportShareService(pool, logger).resolve('y'.repeat(43))).toBeNull();
  });

  it('长度离谱的 token 直接拒掉，不去打数据库', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    const service = new PassportShareService(pool, logger);
    expect(await service.resolve('')).toBeNull();
    expect(await service.resolve('short')).toBeNull();
    expect(await service.resolve('z'.repeat(500))).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('解析成功时记一次打开', async () => {
    const token = 'a'.repeat(43);
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: 's1',
            user_id: 'u1',
            token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
          },
        ],
      },
    ]);
    const got = await new PassportShareService(pool, logger).resolve(token);
    expect(got).toEqual({ userId: 'u1', shareId: 's1' });
    expect(calls[0].sql).toContain('opened_count = opened_count + 1');
  });

  it('打开记录不含 IP 或 UA —— 那会是第二份没人同意过的数据', async () => {
    const token = 'b'.repeat(43);
    const { pool, calls } = makePool([
      {
        rows: [
          {
            id: 's1',
            user_id: 'u1',
            token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
          },
        ],
      },
    ]);
    await new PassportShareService(pool, logger).resolve(token);
    expect(calls[0].sql).not.toMatch(/ip|user_agent|referer/i);
  });
});

describe('撤销', () => {
  it('对已撤销的再撤一次仍然算成功', async () => {
    // From the patient's side it is: the link does not work either way.
    const { pool } = makePool([{ rows: [{ id: 's1' }], rowCount: 1 }, { rows: [] }]);
    expect(await new PassportShareService(pool, logger).revoke('u1', 's1')).toBe(true);
  });

  it('别人的链接撤不掉', async () => {
    const { pool } = makePool([{ rows: [], rowCount: 0 }]);
    expect(await new PassportShareService(pool, logger).revoke('u2', 's1')).toBe(false);
  });

  it('撤销只按 id + user_id，绝不只按 id', async () => {
    const { pool, calls } = makePool([{ rows: [{ id: 's1' }], rowCount: 1 }, { rows: [] }]);
    await new PassportShareService(pool, logger).revoke('u1', 's1');
    expect(calls[0].sql).toContain('user_id = $2');
  });
});

describe('digestsMatch', () => {
  it('相同摘要为真', () => {
    const h = createHash('sha256').update('x').digest('hex');
    expect(digestsMatch(h, h)).toBe(true);
  });

  it('不同摘要、长度不同、空串都为假', () => {
    const a = createHash('sha256').update('a').digest('hex');
    const b = createHash('sha256').update('b').digest('hex');
    expect(digestsMatch(a, b)).toBe(false);
    expect(digestsMatch(a, a.slice(0, 10))).toBe(false);
    expect(digestsMatch('', '')).toBe(false);
  });
});

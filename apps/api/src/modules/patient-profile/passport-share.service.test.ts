import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SHARE_DAYS,
  digestsMatch,
  formatPickupCode,
  MAX_LIVE_SHARES,
  MAX_PICKUP_ATTEMPTS,
  MAX_SHARE_DAYS,
  normalizeBirthDate,
  normalizePickupCode,
  PassportShareService,
  PICKUP_ALPHABET,
  PICKUP_CODE_LENGTH,
  PICKUP_TTL_MINUTES,
  PickupNeedsBirthDateError,
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

/* ================================================================
 * Pickup codes — db/migrations/024_passport_pickup_codes.sql.
 *
 * Everything below is the security argument, not the feature. A share
 * token is 32 bytes of CSPRNG; a pickup code is eight characters said
 * out loud in a room with other people in it. What makes that safe is
 * exactly three things — fifteen minutes, one use, three attempts —
 * and each of them is only real if it is on the row.
 * ================================================================ */

/** create → live-count, DOB lookup, the CTE insert, the audit row. */
const pickupResponses = (over: Record<string, unknown> = {}) => [
  { rows: [{ n: 0 }] },
  { rows: [{ date_of_birth: new Date('1985-03-12T00:00:00Z') }] },
  {
    rows: [
      row({
        pickup_expires_at: new Date('2026-08-05T00:15:00Z'),
        pickup_attempts: 0,
        pickup_redeemed_at: null,
        pickup_burned_at: null,
        ...over,
      }),
    ],
  },
  { rows: [] },
];

describe('normalizePickupCode —— Crockford 折叠，是给念出来的码用的', () => {
  it('大小写、短横、空格都无所谓', () => {
    expect(normalizePickupCode('k7f3-9qt7')).toBe('K7F39QT7');
    expect(normalizePickupCode('K7F3 9QT7')).toBe('K7F39QT7');
    expect(normalizePickupCode('  k7f39qt7  ')).toBe('K7F39QT7');
  });

  it('I 和 L 折成 1，O 折成 0 —— 这正是念出来时会犯的错', () => {
    // A code drawn as 「1」 and 「0」 gets spoken as「一」「零」and typed
    // as I and O. Failing here would spend an attempt on a
    // transcription error rather than on an attack.
    expect(normalizePickupCode('I0FJ9LT7')).toBe('10FJ91T7');
    expect(normalizePickupCode('ooooiiii')).toBe('00001111');
  });

  it('U 不在字母表里，折不回去，直接拒', () => {
    expect(normalizePickupCode('K7F39QTU')).toBeNull();
  });

  it('长度不对就是 null，绝不返回半清洗的字符串', () => {
    expect(normalizePickupCode('K7F39QT')).toBeNull();
    expect(normalizePickupCode('K7F39QT77')).toBeNull();
    expect(normalizePickupCode('')).toBeNull();
    expect(normalizePickupCode(null)).toBeNull();
    expect(normalizePickupCode(123)).toBeNull();
    expect(normalizePickupCode('-'.repeat(200))).toBeNull();
  });

  it('折叠后混进非字母表字符也拒', () => {
    // Punctuation is stripped, but a letter that is not in the alphabet
    // survives stripping and must not be accepted.
    expect(normalizePickupCode('K7F39QTU')).toBeNull();
  });
});

describe('normalizeBirthDate', () => {
  it('三种写法是同一个输入', () => {
    expect(normalizeBirthDate('19850312')).toBe('1985-03-12');
    expect(normalizeBirthDate('1985-03-12')).toBe('1985-03-12');
    expect(normalizeBirthDate('1985/03/12')).toBe('1985-03-12');
  });

  it('不是真实日期的八位数字要拒，否则会白白烧掉一次尝试', () => {
    expect(normalizeBirthDate('19850231')).toBeNull();
    expect(normalizeBirthDate('19851301')).toBeNull();
    expect(normalizeBirthDate('19850000')).toBeNull();
  });

  it('位数不对、年份离谱、非字符串都拒', () => {
    expect(normalizeBirthDate('1985031')).toBeNull();
    expect(normalizeBirthDate('185-03-12')).toBeNull();
    expect(normalizeBirthDate('18850312')).toBeNull();
    expect(normalizeBirthDate(19850312)).toBeNull();
    expect(normalizeBirthDate(null)).toBeNull();
  });
});

describe('formatPickupCode', () => {
  it('分成两组四位 —— 八个字符念出来不丢位置', () => {
    expect(formatPickupCode('K7F39QT7')).toBe('K7F3-9QT7');
  });

  it('长度不对时原样返回，不假装分组', () => {
    expect(formatPickupCode('K7F3')).toBe('K7F3');
  });
});

describe('生成取件码：明文只存在于那一次响应里', () => {
  it('码是 8 位，且只用 Crockford 字母表', async () => {
    const { pool } = makePool(pickupResponses());
    const created = await new PassportShareService(pool, logger).createPickup('u1');
    expect(created.code).toHaveLength(PICKUP_CODE_LENGTH);
    for (const ch of created.code) expect(PICKUP_ALPHABET).toContain(ch);
  });

  it('落库的是 sha256，明文码不出现在任何一条语句的参数里', async () => {
    const { pool, calls } = makePool(pickupResponses());
    const created = await new PassportShareService(pool, logger).createPickup('u1');
    const insert = calls.find((c) => c.sql.includes('INSERT INTO passport_pickup_codes'));
    expect(insert?.params).toContain(
      createHash('sha256').update(created.code, 'utf8').digest('hex'),
    );
    expect(JSON.stringify(calls.map((c) => c.params))).not.toContain(created.code);
  });

  it('审计行记了「发生过」，没记码', async () => {
    const { pool, calls } = makePool(pickupResponses());
    const created = await new PassportShareService(pool, logger).createPickup('u1');
    const audit = calls.find((c) => c.sql.includes('audit_logs'));
    expect(audit?.sql).toContain('passport_pickup_created');
    expect(JSON.stringify(audit?.params)).toContain('shareId');
    expect(JSON.stringify(audit?.params)).not.toContain(created.code);
  });

  it('父链接的 token 一次都不外传 —— 取件码行没有 URL 持有者', async () => {
    // The parent passport_share_links row needs a token_hash because
    // the column is NOT NULL and unique. If the plaintext ever leaked
    // out of createPickup, a 15-minute two-factor handover would have
    // quietly grown a one-factor URL beside it.
    const { pool } = makePool(pickupResponses());
    const created = await new PassportShareService(pool, logger).createPickup('u1');
    expect(created.token).toBeUndefined();
  });

  it('有效期用分钟，而且是取件码自己的那一列', async () => {
    // The whole point of migration 024: a 30-day pickup code is a
    // password. If this ever reads「days」the feature is broken in the
    // one way that does not look broken.
    const { pool, calls } = makePool(pickupResponses());
    await new PassportShareService(pool, logger).createPickup('u1');
    const insert = calls.find((c) => c.sql.includes('INSERT INTO passport_pickup_codes'));
    expect(insert?.sql).toContain("' minutes')::interval");
    expect(insert?.sql).not.toContain("' days')::interval");
    expect(insert?.params).toContain(String(PICKUP_TTL_MINUTES));
    expect(PICKUP_TTL_MINUTES).toBeLessThanOrEqual(15);
  });

  it('两条 INSERT 在同一条语句里，不会留下无主的 share 行', async () => {
    const { pool, calls } = makePool(pickupResponses());
    await new PassportShareService(pool, logger).createPickup('u1');
    const inserts = calls.filter((c) => c.sql.includes('INSERT INTO passport_share_links'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain('INSERT INTO passport_pickup_codes');
  });

  it('返回的行带着 pickup 状态，链接行则是 null', async () => {
    const { pool } = makePool(pickupResponses());
    const created = await new PassportShareService(pool, logger).createPickup('u1');
    expect(created.pickup).toEqual({
      expiresAt: new Date('2026-08-05T00:15:00Z').toISOString(),
      attempts: 0,
      redeemedAt: null,
      burnedAt: null,
    });

    const plain = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    const link = await new PassportShareService(plain.pool, logger).create('u1');
    expect(link.pickup).toBeNull();
  });
});

describe('新码作废旧码 —— 一个账号同时只有一个活的取件码', () => {
  /**
   * The failure this closes is mundane and it is the likely one: the
   * patient reads out K7F3-9QTM, the doctor mishears a character, the
   * patient taps again. Before this, the code that was actually spoken
   * into the room stayed redeemable for the rest of its window with
   * nobody watching it.
   */
  const supersedeSql = async () => {
    const { pool, calls } = makePool(pickupResponses());
    await new PassportShareService(pool, logger).createPickup('u1');
    return calls.find((c) => c.sql.includes('INSERT INTO passport_pickup_codes'))!.sql;
  };

  it('铸码那条语句里就把旧的活取件码撤掉了', async () => {
    const sql = await supersedeSql();
    expect(sql).toContain('UPDATE passport_share_links prev');
    expect(sql).toContain('SET revoked_at = NOW()');
    // Same statement as the mint, not a second round trip: a supersede
    // that ran alone could burn the code the patient already read out
    // and then fail to mint a replacement.
    expect(sql).toContain('INSERT INTO passport_share_links');
    expect(sql).toContain('INSERT INTO passport_pickup_codes');
  });

  it('只作废这个账号的、还活着的取件码 —— 不碰链接、不碰别人', async () => {
    const sql = await supersedeSql();
    expect(sql).toContain('prev.user_id = $1');
    // Joined through the pickup table, so a plain URL share the patient
    // sent their doctor last week is untouched.
    expect(sql).toContain('pc.share_id = prev.id');
    expect(sql).toContain('prev.revoked_at IS NULL');
    expect(sql).toContain('pc.redeemed_at IS NULL');
    expect(sql).toContain('pc.burned_at IS NULL');
    expect(sql).toContain('pc.expires_at > NOW()');
  });

  it('作废走的是父链接的 revoked_at，不是 burned_at', async () => {
    // burned_at means one specific thing on the patient's screen —
    // 「出生日期输错三次」 — and that is not what happened here. The
    // parent's revoked_at is what redeemPickup already refuses on.
    const sql = await supersedeSql();
    expect(sql).not.toMatch(/SET[\s\S]*burned_at\s*=\s*NOW\(\)/);
  });

  it('审计行记下这次铸码顶掉了几个旧码', async () => {
    const { pool, calls } = makePool(pickupResponses({ superseded_count: 1 }));
    await new PassportShareService(pool, logger).createPickup('u1');
    const audit = calls.find((c) => c.sql.includes('audit_logs'));
    expect(JSON.parse(String(audit?.params[0])).supersededCount).toBe(1);
  });
});

describe('没有出生日期就不发码', () => {
  it('抛 PickupNeedsBirthDateError，而不是发一个第二因子永远对不上的码', async () => {
    const { pool } = makePool([{ rows: [{ n: 0 }] }, { rows: [{ date_of_birth: null }] }]);
    await expect(new PassportShareService(pool, logger).createPickup('u1')).rejects.toBeInstanceOf(
      PickupNeedsBirthDateError,
    );
  });

  it('档案根本不存在时同样拒绝，且一行都不写', async () => {
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [] }]);
    await expect(new PassportShareService(pool, logger).createPickup('u1')).rejects.toBeInstanceOf(
      PickupNeedsBirthDateError,
    );
    expect(calls.some((c) => c.sql.includes('INSERT'))).toBe(false);
  });

  it('活跃门的上限对取件码同样生效 —— 它也是一扇门', async () => {
    const { pool } = makePool([{ rows: [{ n: MAX_LIVE_SHARES }] }]);
    await expect(new PassportShareService(pool, logger).createPickup('u1')).rejects.toBeInstanceOf(
      ShareLimitReachedError,
    );
  });
});

describe('码撞了要重试，不能 500', () => {
  it('唯一索引冲突时换一个码再来', async () => {
    // 40 bits will collide eventually, and the unique index is what
    // stops redemption from updating two rows — so a collision has to
    // be a retry, not an error page in a consulting room.
    const calls: Call[] = [];
    let insertAttempts = 0;
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        // 「count(*)::int AS n」, not 「count(*)」: the mint statement
        // counts its own superseded rows, and the looser match sent the
        // insert down this branch and quietly broke the retry.
        if (sql.includes('count(*)::int AS n')) return { rows: [{ n: 0 }], rowCount: 1 };
        if (sql.includes('date_of_birth')) {
          return { rows: [{ date_of_birth: '1985-03-12' }], rowCount: 1 };
        }
        if (sql.includes('INSERT INTO passport_pickup_codes')) {
          insertAttempts += 1;
          if (insertAttempts === 1) {
            throw Object.assign(new Error('duplicate key'), { code: '23505' });
          }
          return { rows: [row({ pickup_expires_at: new Date() })], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const created = await new PassportShareService(pool as never, logger).createPickup('u1');
    expect(insertAttempts).toBe(2);
    expect(created.code).toHaveLength(PICKUP_CODE_LENGTH);
  });
});

describe('兑换：一条语句里判过期、判用过、判烧掉、计次', () => {
  const okRow = { user_id: 'u1', share_id: 's1', dob_ok: true };

  it('格式不对的码或日期根本不打数据库', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    const service = new PassportShareService(pool, logger);
    expect(await service.redeemPickup('short', '19850312')).toBeNull();
    expect(await service.redeemPickup('K7F39QT7', '19850231')).toBeNull();
    expect(await service.redeemPickup(undefined, undefined)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('只发一条语句 —— 读一次再写一次会留出并发的缝', async () => {
    const { pool, calls } = makePool([{ rows: [okRow] }]);
    await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312');
    expect(calls).toHaveLength(1);
  });

  it('过期、用过、烧掉、父链接被撤销，都写在同一条语句的 WHERE 里', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312');
    const sql = calls[0].sql;
    expect(sql).toContain('p.redeemed_at IS NULL');
    expect(sql).toContain('p.burned_at IS NULL');
    expect(sql).toContain('p.expires_at > NOW()');
    expect(sql).toContain('p.attempts < $3');
    expect(sql).toContain('s.revoked_at IS NULL');
    expect(sql).toContain('s.expires_at > NOW()');
  });

  it('第二因子来自 patient_profiles 的当前值，不是这张表里的副本', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312');
    expect(calls[0].sql).toContain('patient_profiles');
    expect(calls[0].sql).toContain('pr.date_of_birth IS NOT NULL');
    expect(calls[0].params[1]).toBe('1985-03-12');
  });

  it('UPDATE 自己也再判一次 —— 并发下 CTE 拿的是旧快照', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312');
    // The guards must appear twice: once selecting the candidate, once
    // in the UPDATE's own WHERE, which is what READ COMMITTED
    // re-evaluates against the row it just locked.
    const sql = calls[0].sql;
    expect(sql.match(/p\.redeemed_at IS NULL/g)).toHaveLength(2);
    expect(sql.match(/p\.burned_at IS NULL/g)).toHaveLength(2);
    expect(sql.match(/p\.attempts < \$3/g)).toHaveLength(2);
  });

  it('错一次只加计数，第三次错才烧', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312');
    const sql = calls[0].sql;
    expect(sql).toContain('ELSE p.attempts + 1 END');
    expect(sql).toContain('NOT c.dob_ok AND p.attempts + 1 >= $3');
    expect(calls[0].params[2]).toBe(MAX_PICKUP_ATTEMPTS);
    expect(MAX_PICKUP_ATTEMPTS).toBe(3);
  });

  it('对上了才算打开，并且顺手记在父链接上', async () => {
    const { pool, calls } = makePool([{ rows: [okRow] }]);
    const got = await new PassportShareService(pool, logger).redeemPickup(
      'k7f3-9qt7',
      '1985/03/12',
    );
    expect(got).toEqual({ userId: 'u1', shareId: 's1' });
    expect(calls[0].sql).toContain('opened_count = s.opened_count + 1');
    expect(calls[0].sql).toContain('spent.dob_ok');
  });

  it('打开记录里没有 IP 或 UA', async () => {
    const { pool, calls } = makePool([{ rows: [okRow] }]);
    await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312');
    expect(calls[0].sql).not.toMatch(/\bip\b|user_agent|referer/i);
  });

  it('码对了但生日错了 —— 返回 null，和「不存在」长得一模一样', async () => {
    const { pool } = makePool([{ rows: [{ user_id: 'u1', share_id: 's1', dob_ok: false }] }]);
    expect(
      await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19900101'),
    ).toBeNull();
  });

  it('查不到就是 null', async () => {
    const { pool } = makePool([{ rows: [] }]);
    expect(
      await new PassportShareService(pool, logger).redeemPickup('K7F39QT7', '19850312'),
    ).toBeNull();
  });

  it('查库用的是折叠后的码的摘要，明文一次都没进过参数', async () => {
    const { pool, calls } = makePool([{ rows: [] }]);
    await new PassportShareService(pool, logger).redeemPickup('k7f3-9qt7', '19850312');
    expect(calls[0].params[0]).toBe(createHash('sha256').update('K7F39QT7', 'utf8').digest('hex'));
    expect(JSON.stringify(calls[0].params)).not.toContain('k7f3-9qt7');
  });
});

describe('列表把取件码和链接放在同一张清单上', () => {
  it('LEFT JOIN 取件码表，并把状态带回来', async () => {
    const { pool, calls } = makePool([
      {
        rows: [
          row({
            pickup_expires_at: new Date('2026-08-05T00:15:00Z'),
            pickup_attempts: 2,
            pickup_redeemed_at: null,
            pickup_burned_at: null,
          }),
          row({ id: 's2' }),
        ],
      },
    ]);
    const listed = await new PassportShareService(pool, logger).list('u1');
    expect(calls[0].sql).toContain('LEFT JOIN passport_pickup_codes');
    expect(listed[0].pickup?.attempts).toBe(2);
    // A plain link has no pickup half, and must not be shown as one.
    expect(listed[1].pickup).toBeNull();
  });
});

describe('容量上限不把自己马上要作废的那一行算进去', () => {
  /**
   * The scenario supersede-on-mint exists for: the patient reads the
   * code out, the doctor mishears a character, they tap again. If the
   * cap counted the live pickup this very call is about to burn, a
   * patient at MAX_LIVE_SHARES would get a 409 in the consulting room
   * for a call that frees a slot before it takes one.
   */
  it('生成取件码时，查询排除掉还活着的取件码行', async () => {
    const { pool, calls } = makePool([
      { rows: [{ n: 0 }] },
      { rows: [{ date_of_birth: '1990-01-01' }] },
      { rows: [row()] },
      { rows: [] },
    ]);
    await new PassportShareService(pool, logger).createPickup('u1').catch(() => undefined);
    const capacity = calls.find((c) => c.sql.includes('count(*)::int'));
    expect(capacity?.sql).toContain('passport_pickup_codes');
    expect(capacity?.sql).toContain('redeemed_at IS NULL');
    expect(capacity?.params[1]).toBe(true);
  });

  it('生成普通分享链接时不排除 —— 那条路径没有要作废的东西', async () => {
    const { pool, calls } = makePool([{ rows: [{ n: 0 }] }, { rows: [row()] }, { rows: [] }]);
    await new PassportShareService(pool, logger).create('u1');
    const capacity = calls.find((c) => c.sql.includes('count(*)::int'));
    expect(capacity?.params[1]).toBe(false);
  });
});

import {
  buildShareUrl,
  describePickupState,
  describeShareLife,
  isPickupLive,
  isShareLive,
  isShareRowLive,
  PICKUP_MAX_ATTEMPTS,
  type PassportShare,
} from '../passport-share';

/**
 * A share link is a live credential to one patient's medical record.
 * The two things this module must get right are what counts as live —
 * a patient reading this list is deciding whether someone can still
 * read their record — and never writing the token anywhere.
 */

const share = (over: Partial<PassportShare> = {}): PassportShare => ({
  id: 's1',
  label: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  expiresAt: '2026-08-12T12:00:00.000Z',
  revokedAt: null,
  openedCount: 0,
  lastOpenedAt: null,
  pickup: null,
  ...over,
});

const NOW = new Date('2026-08-05T12:00:00.000Z');

describe('什么算「还能被人读到」', () => {
  it('未撤销且未过期 = 活的', () => {
    expect(isShareLive(share(), NOW)).toBe(true);
  });

  it('撤销了就不算，哪怕还没到期', () => {
    expect(isShareLive(share({ revokedAt: '2026-08-03T12:00:00.000Z' }), NOW)).toBe(false);
  });

  it('过期了就不算，哪怕从没被撤销', () => {
    // Both halves matter: a patient scanning this list is asking「现在
    // 谁还能看」, and either condition alone answers it wrong.
    expect(isShareLive(share({ expiresAt: '2026-08-04T12:00:00.000Z' }), NOW)).toBe(false);
  });

  it('日期读不出来时按「不是活的」处理', () => {
    // Failing closed: telling someone a link is dead when it might be
    // live invites them to relax about it.
    expect(isShareLive(share({ expiresAt: 'not a date' }), NOW)).toBe(false);
  });
});

describe('剩余时间说人话', () => {
  it('给天数，不给时间戳', () => {
    expect(describeShareLife(share(), NOW)).toBe('7 天后过期');
  });

  it('不足一天时给小时，不足一小时给分钟 —— 且永远不说「0 天」', () => {
    // This started as「不到 1 天后过期」, which was fine for a seven-day
    // link in its last hours and is a lie about a fifteen-minute pickup
    // code: someone standing in a consulting room reading it has no way
    // to know they have four minutes left.
    expect(describeShareLife(share({ expiresAt: '2026-08-05T20:00:00.000Z' }), NOW)).toBe(
      '约 8 小时后过期',
    );
    expect(describeShareLife(share({ expiresAt: '2026-08-05T12:04:00.000Z' }), NOW)).toBe(
      '约 4 分钟后过期',
    );
    // The property that must hold whatever the wording becomes.
    for (const ms of [30_000, 90_000, 3_600_000, 7_200_000, 86_000_000]) {
      const text = describeShareLife(
        share({ expiresAt: new Date(NOW.getTime() + ms).toISOString() }),
        NOW,
      );
      expect(text).not.toContain('0 天');
      expect(text).not.toBe('已过期');
    }
  });

  it('撤销和过期分开说', () => {
    expect(describeShareLife(share({ revokedAt: '2026-08-02T12:00:00.000Z' }), NOW)).toBe('已撤销');
    expect(describeShareLife(share({ expiresAt: '2026-08-01T12:00:00.000Z' }), NOW)).toBe('已过期');
  });
});

/* ================================================================
 * Pickup rows in 「谁现在能看我的记录」.
 *
 * A pickup code dies in four different ways and a link dies in two, so
 * the two predicates are not interchangeable — which is exactly the bug
 * these pin: the screen used isShareLive for every row, so a code that
 * had already been redeemed still offered 撤销.
 * ================================================================ */

const pickupShare = (
  pickup: Partial<NonNullable<PassportShare['pickup']>> = {},
  over: Partial<PassportShare> = {},
): PassportShare =>
  share({
    pickup: {
      expiresAt: '2026-08-05T12:15:00.000Z',
      attempts: 0,
      redeemedAt: null,
      burnedAt: null,
      ...pickup,
    },
    ...over,
  });

describe('取件码「还活着吗」和链接不是同一个问题', () => {
  it('没用过、没烧掉、没撤销、没过期 = 活的', () => {
    expect(isPickupLive(pickupShare(), NOW)).toBe(true);
  });

  it('已被取走的码是死的 —— 哪怕父链接还没到期', () => {
    // This is the case the screen got wrong: isShareLive says true here
    // (the parent link is unrevoked and unexpired), so a spent code was
    // still offering a 撤销 button that does nothing.
    const spent = pickupShare({ redeemedAt: '2026-08-05T12:05:00.000Z' });
    expect(isShareLive(spent, NOW)).toBe(true);
    expect(isPickupLive(spent, NOW)).toBe(false);
  });

  it('烧掉的、撤销的、过期的，都不算活的', () => {
    expect(isPickupLive(pickupShare({ burnedAt: '2026-08-05T12:05:00.000Z' }), NOW)).toBe(false);
    expect(isPickupLive(pickupShare({}, { revokedAt: '2026-08-05T12:05:00.000Z' }), NOW)).toBe(
      false,
    );
    expect(isPickupLive(pickupShare({ expiresAt: '2026-08-05T11:00:00.000Z' }), NOW)).toBe(false);
  });

  it('日期读不出来时按「不是活的」处理', () => {
    expect(isPickupLive(pickupShare({ expiresAt: 'not a date' }), NOW)).toBe(false);
  });

  it('根本不是取件码的行返回 false，而不是假装它是', () => {
    expect(isPickupLive(share(), NOW)).toBe(false);
  });
});

describe('清单上哪一行还配有「撤销」按钮', () => {
  it('取件码行问 isPickupLive，链接行问 isShareLive', () => {
    // The screen asked isShareLive of every row. For a code the doctor
    // already used, that answers true — so the row kept offering 撤销,
    // a button that does nothing, on the one screen whose job is
    // telling the patient which doors are open.
    const spent = pickupShare({ redeemedAt: '2026-08-05T12:05:00.000Z' });
    expect(isShareRowLive(spent, NOW)).toBe(false);
    expect(isShareRowLive(pickupShare(), NOW)).toBe(true);
    expect(isShareRowLive(share(), NOW)).toBe(true);
    expect(isShareRowLive(share({ revokedAt: '2026-08-03T12:00:00.000Z' }), NOW)).toBe(false);
  });

  it('对每一种死法都同意 isPickupLive 的判断', () => {
    for (const dead of [
      pickupShare({ redeemedAt: '2026-08-05T12:05:00.000Z' }),
      pickupShare({ burnedAt: '2026-08-05T12:05:00.000Z' }),
      pickupShare({}, { revokedAt: '2026-08-05T12:05:00.000Z' }),
      pickupShare({ expiresAt: '2026-08-05T11:00:00.000Z' }),
    ]) {
      expect(isShareRowLive(dead, NOW)).toBe(isPickupLive(dead, NOW));
      expect(isShareRowLive(dead, NOW)).toBe(false);
    }
  });
});

describe('取件码那一行说的话', () => {
  it('还能用的时候给分钟数', () => {
    expect(describePickupState(pickupShare(), NOW)).toBe('还能用约 15 分钟');
  });

  it('输错过就说还剩几次', () => {
    expect(describePickupState(pickupShare({ attempts: 1 }), NOW)).toBe(
      `还能用约 15 分钟 · 有人输错过 1 次，再错 ${PICKUP_MAX_ATTEMPTS - 1} 次就作废`,
    );
  });

  it('作废的行不说「已撤销」—— 患者可能根本没点过撤销', () => {
    // Minting a new pickup code revokes the account's previous live one
    // inside the same statement (passport-share.service.ts). The row
    // cannot tell a patient-initiated revoke from a supersede, so it
    // names both possibilities instead of asserting the one they did
    // not do and sending them hunting for a tap they never made.
    const revoked = describePickupState(pickupShare({}, { revokedAt: '2026-08-05T12:05:00.000Z' }));
    expect(revoked).toContain('已作废');
    expect(revoked).toContain('被后一个取件码顶替');
    expect(revoked).not.toBe('已撤销');
  });

  it('被取走和被烧掉分开说，且烧掉那条说清楚是出生日期错', () => {
    expect(describePickupState(pickupShare({ redeemedAt: '2026-08-05T12:05:00.000Z' }), NOW)).toBe(
      '已被医生取走一次 · 取件码是一次性的，已失效',
    );
    expect(describePickupState(pickupShare({ burnedAt: '2026-08-05T12:05:00.000Z' }), NOW)).toBe(
      `出生日期输错 ${PICKUP_MAX_ATTEMPTS} 次，取件码已作废`,
    );
  });

  it('不是取件码的行返回 null，让调用方回落到链接的说法', () => {
    expect(describePickupState(share(), NOW)).toBeNull();
  });
});

describe('链接 URL 由调用方给出 origin', () => {
  it('拼出可转发的地址', () => {
    expect(buildShareUrl('abc123', 'https://ai.example.com')).toBe(
      'https://ai.example.com/s/passport/abc123',
    );
  });

  it('没有 origin 时返回 null，而不是拼一个错的域名', () => {
    // Native has no origin at all, and the same bundle is served from a
    // domain, an IP and a dev machine. A link with the wrong host is
    // worse than no link.
    expect(buildShareUrl('abc123', null)).toBeNull();
    expect(buildShareUrl('abc123', undefined)).toBeNull();
    expect(buildShareUrl('abc123', '')).toBeNull();
  });

  it('不是 http(s) origin 的一律拒绝', () => {
    expect(buildShareUrl('abc', 'file:///tmp')).toBeNull();
    expect(buildShareUrl('abc', 'https://a.com/already/a/path')).toBeNull();
    expect(buildShareUrl('abc', 'javascript:alert(1)')).toBeNull();
  });

  it('没有 token 就没有链接', () => {
    expect(buildShareUrl('', 'https://ai.example.com')).toBeNull();
  });
});

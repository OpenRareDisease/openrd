import {
  buildShareUrl,
  describeShareLife,
  isShareLive,
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

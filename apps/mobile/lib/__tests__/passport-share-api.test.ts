import {
  createPassportPickup,
  createPassportShare,
  listPassportShares,
  revokePassportShare,
} from '../passport-share-api';

jest.mock('../api', () => ({ apiRequest: jest.fn() }));

const { apiRequest } = require('../api') as { apiRequest: jest.Mock };

/**
 * These assert against ACTUAL response bodies, copied from what
 * passport-share.routes.ts returns.
 *
 * The previous tests here covered only the pure predicates, and the
 * network module carried a comment saying it was "a thin wrapper with
 * nothing in it to get wrong". It was the only thing that was wrong:
 * `apiRequest`'s type parameter is an unchecked assertion, so
 * `apiRequest<PassportShare[]>('/passport-shares')` typechecked, passed
 * everything, and returned `{ data: [...] }` at runtime. A generic
 * proves nothing; only a real body does.
 */

const SHARE_BODY = {
  id: 's1',
  label: null,
  createdAt: '2026-08-05T12:00:00.000Z',
  expiresAt: '2026-08-12T12:00:00.000Z',
  revokedAt: null,
  openedCount: 0,
  lastOpenedAt: null,
};

beforeEach(() => apiRequest.mockReset());

describe('信封必须拆开 —— 泛型断言不算数', () => {
  it('列表从 { data: [...] } 里取出数组', () => {
    apiRequest.mockResolvedValue({ data: [SHARE_BODY] });
    return listPassportShares().then((shares) => {
      expect(shares).toHaveLength(1);
      expect(shares[0].id).toBe('s1');
    });
  });

  it('创建从 { data: {...} } 里取出 token', async () => {
    // The failure this pins: link.token was undefined, the 「链接已生成」
    // block never rendered, the patient pressed again — and each press
    // minted a real credential the blank list could not show them.
    apiRequest.mockResolvedValue({ data: { ...SHARE_BODY, token: 'tok_abc' } });
    const link = await createPassportShare();
    expect(link.token).toBe('tok_abc');
  });

  it('没有 token 时抛错，而不是静默成功', async () => {
    // The server has already issued a live credential by then. Silent
    // success is what lets someone press five times.
    apiRequest.mockResolvedValue({ data: SHARE_BODY });
    await expect(createPassportShare()).rejects.toThrow(/没有返回链接/);
  });

  it('裸响应体也能work，以防路由以后改掉信封', async () => {
    apiRequest.mockResolvedValue({ ...SHARE_BODY, token: 'tok_bare' });
    expect((await createPassportShare()).token).toBe('tok_bare');
  });
});

describe('形状不对的东西不进 UI', () => {
  it('列表里缺 id 或 expiresAt 的条目被丢掉', async () => {
    apiRequest.mockResolvedValue({
      data: [SHARE_BODY, { id: 's2' }, { expiresAt: 'x' }, null, 'nope'],
    });
    expect(await listPassportShares()).toHaveLength(1);
  });

  it('响应不是数组时返回空数组，不炸', async () => {
    apiRequest.mockResolvedValue({ data: null });
    expect(await listPassportShares()).toEqual([]);
  });

  it('openedCount 不是数字时归零，界面不会印出 NaN', async () => {
    apiRequest.mockResolvedValue({ data: [{ ...SHARE_BODY, openedCount: 'many' }] });
    expect((await listPassportShares())[0].openedCount).toBe(0);
  });
});

/**
 * The pickup mint response, copied from what passport-share.routes.ts
 * actually sends:
 *
 *   res.status(201).json({ data: link, ttlMinutes, maxAttempts })
 *
 * `ttlMinutes` and `maxAttempts` are SIBLINGS of `data`, not fields
 * inside it. Anything that unwraps first and reads them second gets
 * undefined — which is how they came to be sent by the server and used
 * by nobody, while the screens typed 「15」 and 「3」 out by hand.
 */
const PICKUP_BODY = {
  data: {
    ...SHARE_BODY,
    id: 'p1',
    expiresAt: '2026-08-05T12:15:00.000Z',
    code: 'K7F39QTM',
    pickup: {
      expiresAt: '2026-08-05T12:15:00.000Z',
      attempts: 0,
      redeemedAt: null,
      burnedAt: null,
    },
  },
  ttlMinutes: 15,
  maxAttempts: 3,
};

describe('取件码：信封外面那两个数字也要拿到', () => {
  it('拿到 code、pickup，以及信封外的 ttlMinutes / maxAttempts', async () => {
    apiRequest.mockResolvedValue(PICKUP_BODY);
    const created = await createPassportPickup();
    expect(created.share.code).toBe('K7F39QTM');
    expect(created.share.pickup.expiresAt).toBe('2026-08-05T12:15:00.000Z');
    expect(created.ttlMinutes).toBe(15);
    expect(created.maxAttempts).toBe(3);
  });

  it('服务器没给这两个数字时是 null，不是替换成一个猜的数', async () => {
    // The whole point. A screen that renders 15 because the response
    // did not say is a screen asserting a duration about a live
    // credential that nothing told it.
    apiRequest.mockResolvedValue({ data: PICKUP_BODY.data });
    const created = await createPassportPickup();
    expect(created.ttlMinutes).toBeNull();
    expect(created.maxAttempts).toBeNull();
  });

  it('这两个数字形状不对时也是 null', async () => {
    apiRequest.mockResolvedValue({ ...PICKUP_BODY, ttlMinutes: '15', maxAttempts: 0 });
    const created = await createPassportPickup();
    expect(created.ttlMinutes).toBeNull();
    expect(created.maxAttempts).toBeNull();
  });

  it('没有 code 或没有 pickup 就抛错，而不是静默成功', async () => {
    // Same reason as createPassportShare: by the time this resolves the
    // server has already opened a door, and a card with no expiry is a
    // code the patient cannot tell is dead — in front of the doctor.
    apiRequest.mockResolvedValue({ data: { ...PICKUP_BODY.data, code: undefined } });
    await expect(createPassportPickup()).rejects.toThrow(/没有返回取件码/);

    apiRequest.mockResolvedValue({ data: { ...PICKUP_BODY.data, pickup: { attempts: 0 } } });
    await expect(createPassportPickup()).rejects.toThrow(/没有返回取件码/);
  });
});

describe('撤销', () => {
  it('按 id 打 DELETE', async () => {
    apiRequest.mockResolvedValue({ data: { revoked: true } });
    await revokePassportShare('s 1/x');
    expect(apiRequest).toHaveBeenCalledWith('/passport-shares/s%201%2Fx', { method: 'DELETE' });
  });
});

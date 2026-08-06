import {
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

describe('撤销', () => {
  it('按 id 打 DELETE', async () => {
    apiRequest.mockResolvedValue({ data: { revoked: true } });
    await revokePassportShare('s 1/x');
    expect(apiRequest).toHaveBeenCalledWith('/passport-shares/s%201%2Fx', { method: 'DELETE' });
  });
});

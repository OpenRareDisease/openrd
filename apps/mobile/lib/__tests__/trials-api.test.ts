/**
 * The trials client — what it refuses, and which way it fails.
 *
 * `apiRequest<T>` is an unchecked assertion (lib/api.ts returns the
 * parsed body verbatim), so every field this screen renders has to be
 * checked here or not at all. The refusals below all point the same
 * way: a card that cannot be verified against the registry is not
 * shown, and a run whose outcome cannot be read is treated as one that
 * did not succeed.
 */

const mockApiRequest = jest.fn();
jest.mock('../api', () => ({
  __esModule: true,
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

import { asTrialRecord, listTrials } from '../trials-api';

const rawTrial = (overrides: Record<string, unknown> = {}) => ({
  source: 'ctgov',
  sourceId: 'NCT00000001',
  title: 'A Study of Something in FSHD',
  statusRaw: 'RECRUITING',
  statusZh: '招募中',
  phase: 'PHASE2',
  sponsor: 'Some Sponsor',
  countries: ['United States'],
  url: 'https://clinicaltrials.gov/study/NCT00000001',
  sourceUpdatedAt: '2026-06-01',
  fetchedAt: '2026-08-12T02:00:00.000Z',
  ...overrides,
});

const rawSource = (overrides: Record<string, unknown> = {}) => ({
  source: 'ctgov',
  recordCount: 1,
  fetchedAt: '2026-08-12T02:00:00.000Z',
  lastRun: {
    startedAt: '2026-08-12T02:00:00.000Z',
    finishedAt: '2026-08-12T02:00:03.000Z',
    ok: true,
  },
  lastSuccessAt: '2026-08-12T02:00:03.000Z',
  ...overrides,
});

beforeEach(() => {
  mockApiRequest.mockReset();
});

describe('GET /trials', () => {
  it('打的是 /trials，不带查询串', async () => {
    mockApiRequest.mockResolvedValue({ trials: [], sources: [] });
    await listTrials();
    expect(mockApiRequest).toHaveBeenCalledWith('/trials');
  });

  it('读得懂 { data: ... } 信封', async () => {
    mockApiRequest.mockResolvedValue({ data: { trials: [rawTrial()], sources: [rawSource()] } });
    const snapshot = await listTrials();
    expect(snapshot.trials).toHaveLength(1);
    expect(snapshot.sources).toHaveLength(1);
  });

  it('整个 body 不是对象时抛错，而不是当成空名单', async () => {
    // An empty snapshot would put the screen into its 「注册库这次没
    // 有取到」 copy, which blames the registry for our own broken
    // endpoint.
    mockApiRequest.mockResolvedValue('<!doctype html>');
    await expect(listTrials()).rejects.toThrow(/格式看不懂/);
  });

  it('body 里没有 trials 时是空名单，交给页面去说是哪一种空', async () => {
    mockApiRequest.mockResolvedValue({ sources: [rawSource({ recordCount: 0 })] });
    const snapshot = await listTrials();
    expect(snapshot.trials).toEqual([]);
    expect(snapshot.sources).toHaveLength(1);
  });
});

describe('一条记录必须带齐哪些字段', () => {
  it('齐全时逐字读进来', () => {
    expect(asTrialRecord(rawTrial())).toEqual({
      source: 'ctgov',
      sourceId: 'NCT00000001',
      title: 'A Study of Something in FSHD',
      statusRaw: 'RECRUITING',
      statusZh: '招募中',
      phase: 'PHASE2',
      sponsor: 'Some Sponsor',
      countries: ['United States'],
      url: 'https://clinicaltrials.gov/study/NCT00000001',
      sourceUpdatedAt: '2026-06-01',
      fetchedAt: '2026-08-12T02:00:00.000Z',
    });
  });

  it.each([
    ['source', { source: 'pubmed' }],
    ['sourceId', { sourceId: '' }],
    ['title', { title: null }],
    ['statusRaw', { statusRaw: '   ' }],
    ['url', { url: undefined }],
  ])('缺 %s 的记录整条丢掉', (_field, overrides) => {
    expect(asTrialRecord(rawTrial(overrides))).toBeNull();
  });

  it('不是 http(s) 的链接整条丢掉', () => {
    // The card hands this straight to Linking.openURL. AnswerText.tsx
    // makes the same refusal for the same reason.
    expect(asTrialRecord(rawTrial({ url: 'javascript:alert(1)' }))).toBeNull();
  });

  it('可缺的字段缺了就是 null，不是空字符串', () => {
    const record = asTrialRecord(
      rawTrial({ statusZh: null, phase: '', sponsor: '  ', sourceUpdatedAt: undefined }),
    );
    expect(record).toMatchObject({
      statusZh: null,
      phase: null,
      sponsor: null,
      sourceUpdatedAt: null,
    });
  });

  it('读不出的 fetchedAt 是 null —— 页面据此拒绝显示这份名单', () => {
    expect(asTrialRecord(rawTrial({ fetchedAt: 'sometime last week' }))?.fetchedAt).toBeNull();
    expect(asTrialRecord(rawTrial({ fetchedAt: null }))?.fetchedAt).toBeNull();
  });

  it('地点数组里的非字符串被剔掉，但真的地点留下', () => {
    expect(asTrialRecord(rawTrial({ countries: [null, 'China', 7] }))?.countries).toEqual([
      'China',
    ]);
    expect(asTrialRecord(rawTrial({ countries: 'China' }))?.countries).toEqual([]);
  });

  it('坏的那条丢掉，其余的照常显示', async () => {
    mockApiRequest.mockResolvedValue({
      trials: [rawTrial(), rawTrial({ sourceId: 'NCT2', url: 'ftp://x/y' }), null],
      sources: [rawSource()],
    });
    const snapshot = await listTrials();
    expect(snapshot.trials.map((entry) => entry.sourceId)).toEqual(['NCT00000001']);
  });
});

describe('抓取状态', () => {
  it('ok 不是 true 就一律当成没成功', async () => {
    mockApiRequest.mockResolvedValue({
      trials: [],
      sources: [rawSource({ lastRun: { startedAt: null, finishedAt: null, ok: 'yes' } })],
    });
    const snapshot = await listTrials();
    expect(snapshot.sources[0].lastRun).toEqual({ startedAt: null, finishedAt: null, ok: false });
  });

  it('没有 lastRun 就是 null，不是一次假的成功', async () => {
    mockApiRequest.mockResolvedValue({ trials: [], sources: [rawSource({ lastRun: undefined })] });
    expect((await listTrials()).sources[0].lastRun).toBeNull();
  });

  it('读不出的 recordCount 退回实际收到的条数，而不是 0', async () => {
    // 0 would let the page say「国内没有登记的试验」off a number it
    // never read.
    mockApiRequest.mockResolvedValue({
      trials: [
        rawTrial({
          source: 'chinadrugtrials',
          sourceId: 'CTR1',
          url: 'http://www.chinadrugtrials.org.cn/1',
        }),
        rawTrial({
          source: 'chinadrugtrials',
          sourceId: 'CTR2',
          url: 'http://www.chinadrugtrials.org.cn/2',
        }),
      ],
      sources: [rawSource({ source: 'chinadrugtrials', recordCount: 'lots' })],
    });
    expect((await listTrials()).sources[0].recordCount).toBe(2);
  });

  it('来源名不认识的那一块整块丢掉', async () => {
    mockApiRequest.mockResolvedValue({ trials: [], sources: [rawSource({ source: 'who_knows' })] });
    expect((await listTrials()).sources).toEqual([]);
  });
});

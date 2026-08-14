/**
 * 临床试验 —— the claims this page is allowed to make.
 *
 * Everything asserted here is a sentence a patient reads and acts on,
 * so each block names the specific wrong thing it stops:
 *
 *  1. A status word we invented. The corpus snapshot this feature
 *     replaces rendered `Recruiting` as「招聘」and
 *     `facioscapulohumeral` as「面肩关节疾病」.
 *  2. 「不含仅在国内登记的试验」printed over a list that does contain
 *     them, or 「国内没有」printed when the mainland scraper is simply
 *     down.
 *  3. A date that is one day wrong, or a list with no date at all.
 *  4. 招募中 buried under 已完成.
 */

import {
  COVERAGE_NOTE_CTGOV_ONLY,
  TRIALS_DISCLAIMER,
  describeChinaCoverage,
  describeCtgovStaleness,
  describeEmptyList,
  formatInstantAsDay,
  groupKeyForTrial,
  groupTrials,
  hasChinaSite,
  readRegistryDay,
  resolveFetchedOn,
  sortTrialsForDisplay,
  trialPhaseLabel,
  trialStatusLabel,
  type TrialRecord,
  type TrialSourceStatus,
  type TrialsSnapshot,
} from '../trials';

const trial = (overrides: Partial<TrialRecord> = {}): TrialRecord => ({
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

const sourceStatus = (overrides: Partial<TrialSourceStatus> = {}): TrialSourceStatus => ({
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

const snapshot = (
  trials: TrialRecord[] = [trial()],
  sources: TrialSourceStatus[] = [sourceStatus()],
): TrialsSnapshot => ({ trials, sources });

describe('状态词', () => {
  it('有 status_zh 就用 status_zh', () => {
    expect(trialStatusLabel(trial({ statusRaw: 'RECRUITING', statusZh: '招募中' }))).toBe('招募中');
  });

  it('没有 status_zh 就原样显示注册库的英文，不猜', () => {
    // This is the whole point of `status_zh` being nullable. A word we
    // have no mapping for is shown as the registry wrote it; the
    // alternative is the machine-translated「招聘」in the old snapshot.
    expect(trialStatusLabel(trial({ statusRaw: 'ENROLLING_BY_INVITATION', statusZh: null }))).toBe(
      'ENROLLING_BY_INVITATION',
    );
  });

  it('空白的 status_zh 当成没有，而不是当成空标签', () => {
    expect(trialStatusLabel(trial({ statusRaw: 'SUSPENDED', statusZh: '   ' }))).toBe('SUSPENDED');
  });
});

describe('分组', () => {
  it('按注册库原词分组', () => {
    const byRaw = (statusRaw: string, statusZh: string | null) =>
      groupKeyForTrial(trial({ statusRaw, statusZh }));
    expect(byRaw('RECRUITING', '招募中')).toBe('recruiting');
    expect(byRaw('NOT_YET_RECRUITING', '尚未开始招募')).toBe('not_yet_recruiting');
    expect(byRaw('ACTIVE_NOT_RECRUITING', '进行中·不再招募')).toBe('active_not_recruiting');
    expect(byRaw('COMPLETED', '已完成')).toBe('closed');
    expect(byRaw('TERMINATED', '已终止')).toBe('closed');
    expect(byRaw('WITHDRAWN', '已撤回')).toBe('closed');
  });

  it('status_zh 和原词打架时，以注册库的原词为准', () => {
    // Not hypothetical: `status_zh` is written by our own refresher,
    // so a mapping edit that lands before a re-fetch leaves rows whose
    // translation is a version behind. The wrong direction to resolve
    // that is 招募中 — the one group a patient acts on.
    expect(groupKeyForTrial(trial({ statusRaw: 'NOT_YET_RECRUITING', statusZh: '招募中' }))).toBe(
      'not_yet_recruiting',
    );
  });

  it('原词不认识但 status_zh 认识时，按 status_zh 归组', () => {
    // The mainland registry writes Chinese into `status_raw`. Without
    // this fallback every one of its recruiting studies would land in
    //「其他状态」, i.e. below the fold, i.e. invisible.
    expect(
      groupKeyForTrial(
        trial({ source: 'chinadrugtrials', statusRaw: '进行中（招募中）', statusZh: '招募中' }),
      ),
    ).toBe('recruiting');
  });

  it('两边都不认识就是「其他状态」，不塞进任何一组', () => {
    expect(groupKeyForTrial(trial({ statusRaw: 'UNKNOWN_TO_US', statusZh: null }))).toBe('other');
  });

  it('招募中排在第一组，已完成的在后面', () => {
    const groups = groupTrials([
      trial({ sourceId: 'NCT2', statusRaw: 'COMPLETED', statusZh: '已完成' }),
      trial({ sourceId: 'NCT1', statusRaw: 'RECRUITING', statusZh: '招募中' }),
    ]);
    expect(groups.map((group) => group.spec.key)).toEqual(['recruiting', 'closed']);
  });

  it('收起的只有已结束的那两组 —— 状态词不认识的不算已结束', () => {
    // The census in lib/trials.ts's header: of 92 cached studies, 52
    // are closed (COMPLETED 45 + TERMINATED 7) and 8 more are running
    // without recruiting. Those 60 arrive collapsed because a reader
    // here pays for every screen of scroll. 其他状态 does not: 3 of its
    // 10 rows are ENROLLING_BY_INVITATION, which is a study still
    // taking participants, and a shut toggle would be this page hiding
    // the one thing a reader came for.
    const groups = groupTrials([
      trial({ sourceId: 'NCT1', statusRaw: 'RECRUITING' }),
      trial({ sourceId: 'NCT2', statusRaw: 'NOT_YET_RECRUITING', statusZh: '尚未开始招募' }),
      trial({ sourceId: 'NCT3', statusRaw: 'COMPLETED', statusZh: '已完成' }),
      trial({ sourceId: 'NCT4', statusRaw: 'ACTIVE_NOT_RECRUITING', statusZh: '进行中·不再招募' }),
      trial({ sourceId: 'NCT5', statusRaw: 'ENROLLING_BY_INVITATION', statusZh: null }),
      trial({ sourceId: 'NCT6', statusRaw: 'UNKNOWN', statusZh: null }),
    ]);
    expect(
      groups.filter((group) => !group.spec.initiallyExpanded).map((group) => group.spec.key),
    ).toEqual(['active_not_recruiting', 'closed']);
    expect(
      groups.filter((group) => group.spec.initiallyExpanded).map((group) => group.spec.key),
    ).toEqual(['recruiting', 'not_yet_recruiting', 'other']);
  });

  it('空的组不出现', () => {
    expect(groupTrials([trial()]).map((group) => group.spec.key)).toEqual(['recruiting']);
  });

  it('组内按注册库更新日期从新到旧，没有日期的排最后', () => {
    const sorted = sortTrialsForDisplay([
      trial({ sourceId: 'NCT_OLD', sourceUpdatedAt: '2025-01-01' }),
      trial({ sourceId: 'NCT_NONE', sourceUpdatedAt: null }),
      trial({ sourceId: 'NCT_NEW', sourceUpdatedAt: '2026-06-01' }),
    ]);
    expect(sorted.map((entry) => entry.sourceId)).toEqual(['NCT_NEW', 'NCT_OLD', 'NCT_NONE']);
  });

  it('日期相同时按登记号定序 —— 两次渲染不会换位置', () => {
    const sorted = sortTrialsForDisplay([
      trial({ sourceId: 'NCT_B' }),
      trial({ sourceId: 'NCT_A' }),
    ]);
    expect(sorted.map((entry) => entry.sourceId)).toEqual(['NCT_A', 'NCT_B']);
  });
});

describe('期别', () => {
  it('把 ClinicalTrials.gov 的枚举写成中文', () => {
    expect(trialPhaseLabel('PHASE2')).toBe('2 期');
    expect(trialPhaseLabel('EARLY_PHASE1')).toBe('早期 1 期');
    expect(trialPhaseLabel('NA')).toBe('不按期别划分');
  });

  it('跨两期的研究两个都写出来', () => {
    expect(trialPhaseLabel('PHASE1|PHASE2')).toBe('1 期 / 2 期');
  });

  it('不认识的词原样带过去', () => {
    expect(trialPhaseLabel('II期')).toBe('II期');
  });

  it('空的期别是 null，不是空字符串', () => {
    // The card renders「注册库未标注」on null. An empty string would
    // render as a blank value, which reads as a rendering bug rather
    // than as a fact about the registry.
    expect(trialPhaseLabel(null)).toBeNull();
    expect(trialPhaseLabel('  ')).toBeNull();
  });
});

describe('中国站点', () => {
  it('注册库写了 China 才算', () => {
    expect(hasChinaSite(trial({ countries: ['United States', 'China'] }))).toBe(true);
  });

  it('香港、台湾不算 —— 这条只复述注册库写的字，不做地理判断', () => {
    expect(hasChinaSite(trial({ countries: ['Hong Kong', 'Taiwan'] }))).toBe(false);
  });

  it('没有地点就不算', () => {
    expect(hasChinaSite(trial({ countries: [] }))).toBe(false);
  });
});

describe('日期', () => {
  it('注册库更新日期只接受 YYYY-MM-DD', () => {
    expect(readRegistryDay('2026-06-01')).toBe('2026-06-01');
  });

  it('时间戳形式一律读成「没有」，而不是切前十个字符', () => {
    // A `date` column serialised as an instant cannot be turned back
    // into a calendar day without picking a timezone to be wrong in,
    // and「注册库更新于 2026-05-31」for a row changed on 06-01 is a
    // wrong date shown with full confidence.
    expect(readRegistryDay('2026-05-31T16:00:00.000Z')).toBeNull();
  });

  it('不存在的日子也读成「没有」', () => {
    expect(readRegistryDay('2026-02-30')).toBeNull();
    expect(readRegistryDay('not a date')).toBeNull();
    expect(readRegistryDay(null)).toBeNull();
  });

  it('抓取时间是时间点，按读者本地的那一天显示', () => {
    const local = new Date('2026-08-12T02:00:00.000Z');
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(
      local.getDate(),
    ).padStart(2, '0')}`;
    expect(formatInstantAsDay('2026-08-12T02:00:00.000Z')).toBe(expected);
  });

  it('读不出的抓取时间是 null', () => {
    expect(formatInstantAsDay('rubbish')).toBeNull();
    expect(formatInstantAsDay(null)).toBeNull();
  });
});

describe('拉取于', () => {
  it('两个来源新鲜度不同时，报最旧的那一次', () => {
    // 「这份名单至少有这么旧」is the reading that cannot mislead. The
    // newest would put today's date over rows copied weeks ago.
    const result = resolveFetchedOn(
      snapshot(
        [trial({ fetchedAt: '2026-08-12T02:00:00.000Z' })],
        [
          sourceStatus({ fetchedAt: '2026-08-12T02:00:00.000Z' }),
          sourceStatus({ source: 'chinadrugtrials', fetchedAt: '2026-07-01T00:00:00.000Z' }),
        ],
      ),
    );
    expect(result).toBe(formatInstantAsDay('2026-07-01T00:00:00.000Z'));
  });

  it('只有一个来源时，就是那一次', () => {
    const result = resolveFetchedOn(
      snapshot([trial()], [sourceStatus({ fetchedAt: '2026-08-12T02:00:00.000Z' })]),
    );
    expect(result).toBe(formatInstantAsDay('2026-08-12T02:00:00.000Z'));
  });

  it('来源块没给时间时退回记录自己带的 fetched_at', () => {
    // Same column read from the other end, not a fallback that
    // invents anything.
    const result = resolveFetchedOn(
      snapshot([trial({ fetchedAt: '2026-08-09T00:00:00.000Z' })], []),
    );
    expect(result).toBe(formatInstantAsDay('2026-08-09T00:00:00.000Z'));
  });

  it('哪里都读不出时间就是 null —— 页面据此拒绝显示名单', () => {
    expect(resolveFetchedOn(snapshot([trial({ fetchedAt: null })], []))).toBeNull();
  });
});

describe('拉取于用的是最旧的那一次', () => {
  it('两个来源新鲜度不同时，「拉取于」报最旧的那一次', () => {
    // 「这份名单至少有这么旧」 is the reading that cannot mislead. There
    // is no per-ROW staleness notice to pair with it: the refresh
    // re-stamps every surviving row and deletes the rest, so a row that
    // fell behind its own source is not a state the data can be in —
    // see the note in lib/trials.ts.
    const snap = snapshot(
      [
        trial({ sourceId: 'NCT_NEW', fetchedAt: '2026-08-12T02:00:00.000Z' }),
        trial({ sourceId: 'NCT_OLD', fetchedAt: '2026-05-01T00:00:00.000Z' }),
      ],
      [],
    );
    expect(resolveFetchedOn(snap)).toBe(formatInstantAsDay('2026-05-01T00:00:00.000Z'));
  });
});

describe('国内那半边', () => {
  it('名单里没有国内记录、也没有抓取记录时，说的是固定那句', () => {
    const notice = describeChinaCoverage(snapshot());
    expect(notice.tone).toBe('plain');
    expect(notice.text).toBe(COVERAGE_NOTE_CTGOV_ONLY);
    expect(notice.text).toContain('不含仅在国内登记的试验');
    expect(notice.text).toContain('chinadrugtrials.org.cn');
  });

  it('国内抓取失败时说出来，并给出上次成功的日期', () => {
    const notice = describeChinaCoverage(
      snapshot(
        [trial()],
        [
          sourceStatus(),
          sourceStatus({
            source: 'chinadrugtrials',
            recordCount: 0,
            fetchedAt: null,
            lastRun: {
              startedAt: '2026-08-12T02:10:00.000Z',
              finishedAt: '2026-08-12T02:10:30.000Z',
              ok: false,
            },
            lastSuccessAt: '2026-07-30T02:00:05.000Z',
          }),
        ],
      ),
    );
    expect(notice.tone).toBe('warn');
    expect(notice.text).toContain('国内这部分这次没有取到');
    expect(notice.text).toContain(
      `上次成功抓取：${formatInstantAsDay('2026-07-30T02:00:05.000Z')}`,
    );
  });

  it('从来没成功过时不编一个日期出来', () => {
    const notice = describeChinaCoverage(
      snapshot(
        [trial()],
        [
          sourceStatus({
            source: 'chinadrugtrials',
            recordCount: 0,
            fetchedAt: null,
            lastRun: { startedAt: '2026-08-12T02:10:00.000Z', finishedAt: null, ok: false },
            lastSuccessAt: null,
          }),
        ],
      ),
    );
    expect(notice.tone).toBe('warn');
    // finished_at IS NULL with ok=false is「started and never came
    // back」— still running, or killed. The wording has to be true of
    // both, so it must not say「失败」.
    expect(notice.text).toContain('还没有返回结果');
    expect(notice.text).toContain('到目前为止还没有成功抓取过');
  });

  it('国内记录还在、但最近一次抓取没成功时，说这几条可能已经不是最新的', () => {
    // The rows are the survivors of an older run. Under the calm
    // provenance sentence alone they would read as current, which is
    // the silent-staleness twin of showing an empty list in silence.
    const notice = describeChinaCoverage(
      snapshot(
        [trial(), trial({ source: 'chinadrugtrials', sourceId: 'CTR20250001' })],
        [
          sourceStatus(),
          sourceStatus({
            source: 'chinadrugtrials',
            fetchedAt: '2026-07-01T00:00:00.000Z',
            lastRun: {
              startedAt: '2026-08-12T02:10:00.000Z',
              finishedAt: '2026-08-12T02:10:30.000Z',
              ok: false,
            },
            lastSuccessAt: '2026-07-01T00:00:05.000Z',
          }),
        ],
      ),
    );
    expect(notice.tone).toBe('warn');
    expect(notice.text).toContain('最近一次抓取没有成功');
    expect(notice.text).toContain(
      `上次成功抓取：${formatInstantAsDay('2026-07-01T00:00:05.000Z')}`,
    );
  });

  it('名单里真有国内记录时，不再印那句「不含仅在国内登记的试验」', () => {
    // The fixed sentence is a statement about the list on screen. Once
    // the scraper works it stops being true, and printing it anyway
    // would be the page lying about its own contents.
    const notice = describeChinaCoverage(
      snapshot(
        [trial(), trial({ source: 'chinadrugtrials', sourceId: 'CTR20250001' })],
        [sourceStatus(), sourceStatus({ source: 'chinadrugtrials' })],
      ),
    );
    expect(notice.text).not.toContain('不含仅在国内登记的试验');
    expect(notice.text).toContain('可能不完整');
    expect(notice.text).toContain('chinadrugtrials.org.cn');
  });
});

describe('境外那半边过期时', () => {
  it('抓取成功时不出横幅', () => {
    expect(describeCtgovStaleness(snapshot())).toBeNull();
  });

  it('抓取失败时说明名单停在哪一天', () => {
    const notice = describeCtgovStaleness(
      snapshot(
        [trial({ fetchedAt: '2026-08-01T00:00:00.000Z' })],
        [
          sourceStatus({
            fetchedAt: '2026-08-01T00:00:00.000Z',
            lastRun: {
              startedAt: '2026-08-12T02:00:00.000Z',
              finishedAt: '2026-08-12T02:00:30.000Z',
              ok: false,
            },
            lastSuccessAt: '2026-08-01T00:00:05.000Z',
          }),
        ],
      ),
    );
    expect(notice?.tone).toBe('warn');
    expect(notice?.text).toContain('最近一次更新没有成功');
    expect(notice?.text).toContain(formatInstantAsDay('2026-08-01T00:00:00.000Z') as string);
  });
});

describe('一条都没有时', () => {
  it('从没抓过和抓失败了是两句不同的话，都不是「暂无试验」', () => {
    const neverRun = describeEmptyList(snapshot([], [sourceStatus({ lastRun: null })]));
    const failed = describeEmptyList(
      snapshot(
        [],
        [
          sourceStatus({
            lastRun: { startedAt: '2026-08-12T02:00:00.000Z', finishedAt: null, ok: false },
            lastSuccessAt: null,
          }),
        ],
      ),
    );
    expect(neverRun).toContain('还没有抓取过');
    expect(failed).toContain('没有取到');
    expect(neverRun).not.toBe(failed);
    for (const sentence of [neverRun, failed]) {
      expect(sentence).not.toContain('暂无');
    }
  });

  it('抓取报成功却一条都没有时，说的是平台出了问题，不替注册库回答「没有试验」', () => {
    // `ok = TRUE` 加一份空名单，推不出「注册库没有 FSHD 试验」：
    // ctgov 的抓取器遇到 totalCount 为 0 直接报错，写行和 ok 又在同一
    // 个事务里，所以一次成功的抓取必定写进过记录。注册库自己报的零
    // 只在 source_reported_total 里，那一列不上线路。
    const text = describeEmptyList(snapshot([], [sourceStatus({ recordCount: 0 })]));
    expect(text).toContain('平台这边的问题');
    expect(text).toContain('不是注册库上没有 FSHD 试验');
    expect(text).not.toContain('没有返回任何 FSHD 相关的记录');
    expect(text).toContain('上次成功抓取：');
  });

  it('服务端还有记录、却一条都没能读出来时，认的是自己的解析问题', () => {
    // asTrialRecord（lib/trials-api.ts）会丢掉缺 id / 标题 / 状态词或
    // URL 不是 http(s) 的记录。服务端换了个字段名，92 条就能一条不剩
    // 地被丢掉，而 recordCount 仍然是 92。
    const text = describeEmptyList(snapshot([], [sourceStatus({ recordCount: 92 })]));
    expect(text).toContain('没有一条记录能完整读出来');
    expect(text).toContain('本应用这边的问题');
    expect(text).not.toContain('没有返回任何 FSHD 相关的记录');
    // 这一支也覆盖 trials 整个没回来的情形（lib/trials-api.ts 用 [] 顶
    // 替不是数组的 body.trials），那时候并没有名单读回来。
    expect(text).not.toContain('名单读回来了');
  });

  it('抓取报成功、上次成功时间又读不出来时，不在同一句里说自己没成功过', () => {
    const text = describeEmptyList(
      snapshot([], [sourceStatus({ recordCount: 0, lastSuccessAt: null })]),
    );
    expect(text).toContain('抓取本身报的是成功');
    expect(text).not.toContain('还没有成功抓取过');
    expect(text).not.toContain('上次成功抓取');
    expect(text).toContain('平台这边的问题');
  });

  it('国内那半边还有记录时也算本应用的问题，不只看 ctgov', () => {
    const text = describeEmptyList(
      snapshot(
        [],
        [
          sourceStatus({ recordCount: 0 }),
          sourceStatus({ source: 'chinadrugtrials', recordCount: 3 }),
        ],
      ),
    );
    expect(text).toContain('没有一条记录能完整读出来');
  });

  it('四种空名单说的是四句不同的话，没有一句在替注册库回答', () => {
    const neverRun = describeEmptyList(snapshot([], [sourceStatus({ lastRun: null })]));
    const failed = describeEmptyList(
      snapshot(
        [],
        [
          sourceStatus({
            lastRun: { startedAt: '2026-08-12T02:00:00.000Z', finishedAt: null, ok: false },
            lastSuccessAt: null,
          }),
        ],
      ),
    );
    const nothingWritten = describeEmptyList(snapshot([], [sourceStatus({ recordCount: 0 })]));
    const allDropped = describeEmptyList(snapshot([], [sourceStatus({ recordCount: 92 })]));
    const sentences = [neverRun, failed, nothingWritten, allDropped];
    expect(new Set(sentences).size).toBe(4);
    for (const sentence of sentences) {
      expect(sentence).not.toContain('暂无');
      expect(sentence).not.toContain('没有返回任何 FSHD 相关的记录');
      expect(sentence).toContain('clinicaltrials.gov');
    }
  });
});

describe('免责声明', () => {
  it('只说去找医生商量，不判断入组资格，也不谈疗效', () => {
    expect(TRIALS_DISCLAIMER).toContain('主诊医生');
    for (const forbidden of ['你可能符合', '有效', '疗效', '推荐你']) {
      expect(TRIALS_DISCLAIMER).not.toContain(forbidden);
    }
  });
});

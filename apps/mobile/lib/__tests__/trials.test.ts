/**
 * 临床试验 —— the claims this page is allowed to make.
 *
 * Everything asserted here is a sentence a patient reads and acts on,
 * so each block names the specific wrong thing it stops:
 *
 *  1. A status word we invented. The corpus snapshot this feature
 *     replaces rendered `Recruiting` as「招聘」and
 *     `facioscapulohumeral` as「面肩关节疾病」.
 *  2. 「国内没有」printed when the mainland scraper is simply down —
 *     and its quieter twin, our own scope printed over the registry's
 *     answer: a run that came back successful with nothing in it used
 *     to render as「本页只收录 ClinicalTrials.gov 的记录」, which told
 *     the reader we do not fetch that registry at all.
 *  3. A date that is one day wrong, or a list with no date at all.
 *  4. 招募中 buried under 已完成.
 *  5. A sentence about 「下面这份名单」 printed over a screen that is
 *     showing no list —「所以下面这份名单目前只有 ClinicalTrials.gov 的
 *     记录」and「重要的试验请点开原始记录核对」both used to fire on the
 *     empty state, where they contradicted each other and the empty
 *     card underneath them.
 */

import {
  COVERAGE_NOTE_NO_CHINA_RECORDS,
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
  shownListFetchedOn,
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

  it('国内登记平台的状态词也按它自己写的词归组', () => {
    // The words this registry writes, and it writes them with
    // `status_zh` NULL — that is what its fetcher stores. Reading a
    // translation instead put every one of these rows in「其他状态」:
    // a 招募中 study below the fold, and a 已完成 one under a note
    // saying we had no Chinese for its status word.
    const cn = (statusRaw: string) =>
      groupKeyForTrial(
        trial({ source: 'chinadrugtrials', sourceId: 'CTR20252821', statusRaw, statusZh: null }),
      );
    expect(cn('进行中 招募中')).toBe('recruiting');
    expect(cn('进行中 尚未招募')).toBe('not_yet_recruiting');
    expect(cn('已完成')).toBe('closed');
    expect(cn('主动终止')).toBe('closed');
    // The registry's own filter writes the 进行中 sub-state without the
    // parent; its result rows write both. Same status either way.
    expect(cn('招募中')).toBe('recruiting');
    expect(cn('招募完成')).toBe('active_not_recruiting');
  });

  it('国内登记平台的「暂停」不算已停止，进「其他状态」按原词显示', () => {
    // Paused is neither over nor recruiting, and no group header here
    // would be true of it. 其他状态 shows the registry's own word.
    const paused = trial({ source: 'chinadrugtrials', statusRaw: '主动暂停', statusZh: null });
    expect(groupKeyForTrial(paused)).toBe('other');
    expect(trialStatusLabel(paused)).toBe('主动暂停');
  });

  it('不认识的状态词就是「其他状态」，不塞进任何一组', () => {
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

  it('「其他状态」的说明对组里的每一张卡都成立', () => {
    // Every card in this group can be in Chinese already — the mainland
    // registry writes its status word that way — so the note may not
    // explain the group by saying we have no Chinese for those words,
    // and it may not point at a word that is on none of the cards.
    const groups = groupTrials([
      trial({ sourceId: 'NCT6', statusRaw: 'UNKNOWN', statusZh: null }),
      trial({
        source: 'chinadrugtrials',
        sourceId: 'CTR20250001',
        statusRaw: '主动暂停',
        statusZh: null,
      }),
    ]);
    const other = groups.find((group) => group.spec.key === 'other');
    expect(other?.trials).toHaveLength(2);
    expect(other?.spec.note).toContain('卡片上按注册库的原词显示');
    expect(other?.spec.note).not.toContain('中文译法');
    expect(other?.spec.note).not.toContain('ENROLLING_BY_INVITATION');
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

describe('名单到底有没有画出来', () => {
  const failedRun = {
    startedAt: '2026-08-13T02:00:00.000Z',
    finishedAt: '2026-08-13T02:00:30.000Z',
    ok: false,
  };

  it('有记录、也有抓取时间时，报的就是「拉取于」那一天', () => {
    const snap = snapshot();
    expect(shownListFetchedOn(snap)).toBe(resolveFetchedOn(snap));
    expect(shownListFetchedOn(snap)).toBe(formatInstantAsDay('2026-08-12T02:00:00.000Z'));
  });

  it('一条记录都没读出来时是 null —— 哪怕来源块还带着抓取时间', () => {
    // 这一格是 `resolveFetchedOn` 单独看不出来的：它连来源块一起读，
    // 所以服务端说有 92 条、客户端一条都没解析出来的时候，日期还在，
    // 名单却没了。那个日期属于一份没有画出来的名单。
    const snap = snapshot([], [sourceStatus({ recordCount: 92 })]);
    expect(resolveFetchedOn(snap)).not.toBeNull();
    expect(shownListFetchedOn(snap)).toBeNull();
  });

  it('记录回来了但读不出抓取时间时是 null —— 屏幕本来就拒绝显示', () => {
    expect(shownListFetchedOn(snapshot([trial({ fetchedAt: null })], []))).toBeNull();
  });

  it('和分组给出的是同一个答案 —— 有组可画，才可能有名单', () => {
    // 屏幕按 `groupTrials` 的结果画名单，按这个函数写名单上方的话。
    // 两边一旦对不上，横幅就会指着一份不存在的名单。
    const cases: TrialsSnapshot[] = [
      snapshot(),
      snapshot([], [sourceStatus({ recordCount: 92 })]),
      snapshot([], []),
      snapshot([trial({ fetchedAt: null })], []),
      snapshot([trial({ statusRaw: 'UNKNOWN_TO_US', statusZh: null })], [sourceStatus()]),
    ];
    for (const snap of cases) {
      const drawable = groupTrials(snap.trials).length > 0 && resolveFetchedOn(snap) !== null;
      expect(shownListFetchedOn(snap) !== null).toBe(drawable);
    }
  });

  it('固定那句话不声称有一份名单在下面', () => {
    // 它也是请求还在飞、请求失败时印的那一句，那两种情况下下面什么都
    // 没有。
    expect(COVERAGE_NOTE_NO_CHINA_RECORDS).not.toContain('本列表');
    expect(COVERAGE_NOTE_NO_CHINA_RECORDS).not.toContain('下面这份名单');
    expect(COVERAGE_NOTE_NO_CHINA_RECORDS).toContain('chinadrugtrials.org.cn');
  });

  it('固定那句话也不声称本平台不抓国内登记平台', () => {
    // 平台是抓的：chinadrugtrials 在 TRIAL_SOURCES 里，cron 在跑它。
    // 这句话在请求失败时也印，那时候连它这次跑成什么样都不知道，所以
    // 它只说页面上现在没有什么。
    expect(COVERAGE_NOTE_NO_CHINA_RECORDS).not.toContain('只收录');
    expect(COVERAGE_NOTE_NO_CHINA_RECORDS).not.toContain('不含仅在国内登记的试验');
  });

  it('国内取不到、名单又画不出来时，不说名单里剩下什么', () => {
    const noList = [
      snapshot([], [sourceStatus({ source: 'chinadrugtrials', lastRun: failedRun })]),
      snapshot(
        [trial({ fetchedAt: null })],
        [sourceStatus({ source: 'chinadrugtrials', fetchedAt: null, lastRun: failedRun })],
      ),
    ];
    for (const snap of noList) {
      const notice = describeChinaCoverage(snap);
      expect(notice.tone).toBe('warn');
      expect(notice.text).not.toContain('下面这份名单');
      // 该说的还是说了：国内这次没取到，以及去哪儿查。
      expect(notice.text).toContain('国内这部分这次没有取到');
      expect(notice.text).toContain('chinadrugtrials.org.cn');
    }
  });

  it('名单真在下面时，才说它目前只有 ClinicalTrials.gov 的记录', () => {
    const notice = describeChinaCoverage(
      snapshot(
        [trial()],
        [sourceStatus(), sourceStatus({ source: 'chinadrugtrials', lastRun: failedRun })],
      ),
    );
    expect(notice.text).toContain('所以下面这份名单目前只有 ClinicalTrials.gov 的记录');
  });

  it('国内记录在手里但名单没画出来时，也不说「其中」「这几条」', () => {
    // 「其中」和「国内这几条」都是指着屏幕上的行说话。名单没有抓取
    // 时间、屏幕拒绝显示的时候，行一条都不在。
    const notice = describeChinaCoverage(
      snapshot(
        [
          trial({ fetchedAt: null }),
          trial({ source: 'chinadrugtrials', sourceId: 'CTR20250001', fetchedAt: null }),
        ],
        [
          sourceStatus({ fetchedAt: null }),
          sourceStatus({ source: 'chinadrugtrials', fetchedAt: null, lastRun: failedRun }),
        ],
      ),
    );
    expect(notice.text).not.toContain('其中');
    expect(notice.text).not.toContain('国内这几条');
    // 关于国内那半边本身的话仍然成立，也仍然在。
    expect(notice.text).toContain('只能按页面抓取，可能不完整');
    expect(notice.text).toContain('最近一次抓取没有成功');
  });

  it('境外过期的横幅在没有名单可说时整条不出现', () => {
    // 「下面这份名单是 X 抓到的」和「重要的试验请点开原始记录核对」都
    // 以屏幕上的行为主语。空名单那一格由 describeEmptyList 说，没有
    // 抓取时间那一格由屏幕自己的卡片说，两边都没被留成哑巴。
    const noList = [
      snapshot([], [sourceStatus({ recordCount: 0, fetchedAt: null, lastRun: failedRun })]),
      snapshot([], [sourceStatus({ recordCount: 92, lastRun: failedRun })]),
      snapshot(
        [trial({ fetchedAt: null })],
        [sourceStatus({ fetchedAt: null, lastRun: failedRun })],
      ),
    ];
    for (const snap of noList) {
      expect(describeCtgovStaleness(snap)).toBeNull();
    }
  });
});

describe('国内那半边', () => {
  it('负载里根本没有国内那个来源块时，说的是固定那句', () => {
    // 服务端每个注册库都发一块，不管它有没有跑过（apps/api
    // trials.service.ts），所以块不在等于这份负载读不动，而不是一种
    // 可以命名的状态。固定那句是唯一一句对抓取不作任何声称的。
    const notice = describeChinaCoverage(snapshot());
    expect(notice.tone).toBe('plain');
    expect(notice.text).toBe(COVERAGE_NOTE_NO_CHINA_RECORDS);
    expect(notice.text).toContain('chinadrugtrials.org.cn');
  });

  it('来源块在、只是从来没跑过时，说的是还没抓过，而不是固定那句', () => {
    const notice = describeChinaCoverage(
      snapshot(
        [trial()],
        [
          sourceStatus(),
          sourceStatus({
            source: 'chinadrugtrials',
            recordCount: 0,
            fetchedAt: null,
            lastRun: null,
            lastSuccessAt: null,
          }),
        ],
      ),
    );
    expect(notice.tone).toBe('plain');
    expect(notice.text).toContain('国内这部分还没有抓取过');
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

  it('国内记录还在、但最近一次抓取没成功时，说国内这部分可能已经不是最新的', () => {
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

  it('名单里真有国内记录时，不再印那句「本页现在没有来自国内登记平台的记录」', () => {
    // The fixed sentence is a statement about the list on screen. Once
    // the scraper works it stops being true, and printing it anyway
    // would be the page lying about its own contents.
    const notice = describeChinaCoverage(
      snapshot(
        [trial(), trial({ source: 'chinadrugtrials', sourceId: 'CTR20250001' })],
        [sourceStatus(), sourceStatus({ source: 'chinadrugtrials' })],
      ),
    );
    expect(notice.text).not.toContain('本页现在没有来自国内登记平台的记录');
    expect(notice.text).toContain('可能不完整');
    expect(notice.text).toContain('chinadrugtrials.org.cn');
  });
});

/**
 * 国内那次抓取跑成功了，一条记录都没带回来 —— 今天线上就是这个状态。
 *
 * 它以前和「从来没跑过」共用同一句话，而那句话说的是本页只收录
 * ClinicalTrials.gov 的记录。登记库自己的零被印成了我们的缺席，而这
 * 两件事的区别正是把这个来源接进来的全部意义。
 */
describe('国内那次抓取成功了，却一条都没带回来', () => {
  const cnOkZero = (overrides: Partial<TrialSourceStatus> = {}): TrialSourceStatus =>
    sourceStatus({
      source: 'chinadrugtrials',
      recordCount: 0,
      fetchedAt: null,
      lastRun: {
        startedAt: '2026-08-14T00:03:00.000Z',
        finishedAt: '2026-08-14T00:03:31.000Z',
        ok: true,
      },
      lastSuccessAt: '2026-08-14T00:03:31.000Z',
      ...overrides,
    });

  const withList = (cn: TrialSourceStatus): TrialsSnapshot =>
    snapshot([trial()], [sourceStatus(), cn]);
  const withoutList = (cn: TrialSourceStatus): TrialsSnapshot =>
    snapshot([], [sourceStatus({ recordCount: 0, fetchedAt: null }), cn]);

  it('说的是我们抓过、这次抓成了、什么也没带回来', () => {
    const notice = describeChinaCoverage(withList(cnOkZero()));
    expect(notice.text).toContain('国内这部分最近一次抓取');
    expect(notice.text).toContain('是成功的');
    expect(notice.text).toContain('但一条记录都没有取回来');
    expect(notice.text).toContain(formatInstantAsDay('2026-08-14T00:03:31.000Z') as string);
  });

  it('不说本平台不收录国内登记的试验 —— 抓了，而且这次抓成了', () => {
    const notice = describeChinaCoverage(withList(cnOkZero()));
    expect(notice.text).not.toContain('只收录');
    expect(notice.text).not.toContain('不含仅在国内登记的试验');
    expect(notice.text).not.toBe(COVERAGE_NOTE_NO_CHINA_RECORDS);
  });

  it('也不替登记库回答「国内没有相关试验」', () => {
    // ok = TRUE 配一份空名单，分不出「登记库上没有」和「我们的抓取
    // 一条也没认出来」。能分开的是 source_reported_total（迁移 027），
    // 那一列不上线路 —— TrialSourceStatus 没有承接它的字段。
    const notice = describeChinaCoverage(withList(cnOkZero()));
    expect(notice.text).toContain('这不等于国内就没有相关的试验');
  });

  it('不是 warn —— 这一格里没有东西坏掉', () => {
    // warn 是留给读者有权知道的失败的。cron 跑完了，活也干了。
    expect(describeChinaCoverage(withList(cnOkZero())).tone).toBe('plain');
  });

  it('上次成功的时间读不出来时，不在同一句里说自己没成功过', () => {
    const notice = describeChinaCoverage(withList(cnOkZero({ lastSuccessAt: null })));
    expect(notice.text).toContain('是成功的');
    expect(notice.text).not.toContain('到目前为止还没有成功抓取过');
    expect(notice.text).not.toContain('上次成功抓取');
  });

  it('名单没画出来时，不说下面那份名单里剩下什么', () => {
    const notice = describeChinaCoverage(withoutList(cnOkZero()));
    expect(notice.text).not.toContain('下面这份名单');
    // 该说的还是说了。
    expect(notice.text).toContain('但一条记录都没有取回来');
    expect(notice.text).toContain('chinadrugtrials.org.cn');
  });

  it('跑成功却空手、跑失败、从没跑过、真有记录：四句不同的话', () => {
    const failed = cnOkZero({
      lastRun: {
        startedAt: '2026-08-14T00:03:00.000Z',
        finishedAt: '2026-08-14T00:03:31.000Z',
        ok: false,
      },
      lastSuccessAt: '2026-07-30T02:00:05.000Z',
    });
    const neverRan = cnOkZero({ lastRun: null, lastSuccessAt: null });
    const withRecords = snapshot(
      [trial(), trial({ source: 'chinadrugtrials', sourceId: 'CTR20250001' })],
      [sourceStatus(), cnOkZero({ recordCount: 1, fetchedAt: '2026-08-14T00:03:31.000Z' })],
    );
    const sentences = [
      describeChinaCoverage(withList(cnOkZero())).text,
      describeChinaCoverage(withList(failed)).text,
      describeChinaCoverage(withList(neverRan)).text,
      describeChinaCoverage(withRecords).text,
    ];
    expect(new Set(sentences).size).toBe(4);
    for (const sentence of sentences) {
      // 没有一句说本平台不抓这个登记库，也没有一句替它回答。
      expect(sentence).not.toContain('只收录');
      expect(sentence).not.toContain('不含仅在国内登记的试验');
      expect(sentence).toContain('chinadrugtrials.org.cn');
    }
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

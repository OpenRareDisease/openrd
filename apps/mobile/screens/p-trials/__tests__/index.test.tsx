import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * 临床试验 —— the eight ways this screen could mislead the person
 * reading it.
 *
 * 1. Showing the list without saying when it was copied. The list is a
 *    cron-filled cache; undated, it reads as a live query, and a
 *    patient decides whether a trial is still open on that reading.
 * 2. Going quiet when the mainland registry is down. A short list
 *    presented in silence teaches「国内没有」from a fetch that never
 *    landed — the reason `trial_fetch_runs` is part of the feature.
 * 3. Printing our own scope over the mainland registry's answer. A
 *    successful mainland run that came back with nothing used to
 *    render as「本页只收录 ClinicalTrials.gov 的记录，不含仅在国内登记
 *    的试验」—— the reader was told we do not fetch that registry, on
 *    the morning we fetched it. And its mirror image: that sentence
 *    printed over a list that does contain mainland rows.
 * 4. Burying 招募中 — or ENROLLING_BY_INVITATION, which is the same
 *    burial with a word we have no Chinese for. This audience pays for
 *    every screen of scroll, and only a group where every row is
 *    finished may arrive shut.
 * 5. Rendering「暂无试验」for a failed fetch.
 * 6. Going quiet when the ClinicalTrials.gov half stops refreshing.
 *    Its banner is the only thing on screen that says so.
 * 7. Letting the page stop saying what it refuses to do — no
 *    eligibility judgement, no results — which is the sentence that
 *    frames everything under it.
 * 8. Saying 重新读取 without saying that it re-reads our own copy
 *    rather than the registry.
 */

const mockListTrials = jest.fn();
jest.mock('../../../lib/trials-api', () => ({
  __esModule: true,
  listTrials: (...args: unknown[]) => mockListTrials(...args),
}));

jest.mock('../../../lib/api', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader', null) };
});

jest.mock('../../common/Icon', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('Icon', null) };
});

// Kept pressable: every assertion below drives the real controls.
jest.mock('../../common/Button', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: ({
      label,
      onPress,
      accessibilityLabel,
      accessibilityHint,
    }: {
      label: string;
      onPress: () => void;
      accessibilityLabel?: string;
      accessibilityHint?: string;
    }) =>
      ReactLocal.createElement(
        TouchableOpacity,
        {
          onPress,
          accessibilityRole: 'button',
          accessibilityLabel: accessibilityLabel ?? label,
          accessibilityHint,
        },
        ReactLocal.createElement(RNText, null, label),
      ),
  };
});

import { Linking } from 'react-native';

import TrialsScreen from '../index';
import styles from '../styles';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import {
  formatInstantAsDay,
  type TrialRecord,
  type TrialSourceStatus,
  type TrialsSnapshot,
} from '../../../lib/trials';

const FETCHED_AT = '2026-08-12T02:00:00.000Z';
const FETCHED_DAY = formatInstantAsDay(FETCHED_AT) as string;

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
  fetchedAt: FETCHED_AT,
  ...overrides,
});

const sourceStatus = (overrides: Partial<TrialSourceStatus> = {}): TrialSourceStatus => ({
  source: 'ctgov',
  recordCount: 1,
  fetchedAt: FETCHED_AT,
  lastRun: { startedAt: FETCHED_AT, finishedAt: '2026-08-12T02:00:03.000Z', ok: true },
  lastSuccessAt: '2026-08-12T02:00:03.000Z',
  ...overrides,
});

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<TrialsScreen />);
  });
  return tree;
};

/** Every string the screen renders, in tree order. */
const texts = (tree: TestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string');

const screenText = (tree: TestRenderer.ReactTestRenderer): string => texts(tree).join('\n');

const buttonByLabel = (tree: TestRenderer.ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root.findAll(
    (node) =>
      node.props?.accessibilityRole === 'button' &&
      node.props?.accessibilityLabel === label &&
      typeof node.props?.onPress === 'function',
  )[0];

const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

beforeEach(() => {
  mockListTrials.mockReset();
  openURL.mockClear();
});

describe('拉取于', () => {
  it('抓取日期在名单之前 —— 不用滚动就能看见', async () => {
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const rendered = screenText(await render());
    expect(rendered).toContain(`拉取于 ${FETCHED_DAY}`);
    expect(rendered.indexOf(`拉取于 ${FETCHED_DAY}`)).toBeLessThan(
      rendered.indexOf('A Study of Something in FSHD'),
    );
  });

  it('说清楚这是副本不是实时查询', async () => {
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    expect(screenText(await render())).toContain('不是打开页面时的实时查询');
  });

  it('读不出抓取时间就不显示名单', async () => {
    // An undated copy of a registry is a present-tense claim nobody
    // checked. Refusing to draw it is the only honest option left.
    mockListTrials.mockResolvedValue({ trials: [trial({ fetchedAt: null })], sources: [] });
    const rendered = screenText(await render());
    expect(rendered).toContain('这份名单没有抓取时间，暂不显示');
    expect(rendered).not.toContain('A Study of Something in FSHD');
  });
});

describe('固定的那两句话', () => {
  it('负载里连国内那个来源块都没有时，说页面上现在没有它的记录，并给出去哪里查', async () => {
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const rendered = screenText(await render());
    expect(rendered).toContain('本页现在没有来自国内登记平台的记录');
    expect(rendered).toContain('chinadrugtrials.org.cn');
  });

  it('给出的不只是平台名字，还有能点开的入口', async () => {
    // 「国内请查 X」 with no way to get to X is advice this audience
    // cannot act on: typing a URL is the interaction a weak grip is
    // worst at.
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const tree = await render();
    await act(async () => {
      buttonByLabel(tree, '打开药物临床试验登记与信息公示平台').props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith('http://www.chinadrugtrials.org.cn/');
  });

  it('免责声明在名单之前', async () => {
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const rendered = screenText(await render());
    expect(rendered).toContain('请与你的主诊医生商量');
    expect(rendered.indexOf('主诊医生')).toBeLessThan(
      rendered.indexOf('A Study of Something in FSHD'),
    );
  });

  it('这两句话在加载中和出错时也在', async () => {
    // They are the frame the page is read inside, not a footnote on a
    // successful load.
    mockListTrials.mockRejectedValue(new Error('boom'));
    const rendered = screenText(await render());
    expect(rendered).toContain('chinadrugtrials.org.cn');
    expect(rendered).toContain('主诊医生');
    // 请求都没回来，这一格连国内那次抓取跑成什么样都不知道，所以这句
    // 话只说页面上现在没有什么 —— 不声称本平台不抓那个登记库。
    expect(rendered).not.toContain('只收录');
  });
});

describe('国内那半边取不到时', () => {
  it('说出来，并带上上次成功的日期', async () => {
    mockListTrials.mockResolvedValue({
      trials: [trial()],
      sources: [
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
    });
    const rendered = screenText(await render());
    expect(rendered).toContain('国内这部分这次没有取到');
    expect(rendered).toContain(`上次成功抓取：${formatInstantAsDay('2026-07-30T02:00:05.000Z')}`);
    // And the list is still shown — the ctgov half is real data.
    expect(rendered).toContain('A Study of Something in FSHD');
  });
});

describe('国内那半边跑成功了、却一条都没带回来时', () => {
  // 今天线上就是这一格：ctgov 正常，国内那次抓取报的是成功，记录零条。
  // 读者第一天打开这一页，读到的就是下面这几句。
  const CN_OK_ZERO = sourceStatus({
    source: 'chinadrugtrials',
    recordCount: 0,
    fetchedAt: null,
    lastRun: {
      startedAt: '2026-08-14T00:03:00.000Z',
      finishedAt: '2026-08-14T00:03:31.000Z',
      ok: true,
    },
    lastSuccessAt: '2026-08-14T00:03:31.000Z',
  });

  const renderShipping = async () => {
    mockListTrials.mockResolvedValue({
      trials: [trial()],
      sources: [sourceStatus(), CN_OK_ZERO],
    });
    return screenText(await render());
  };

  it('说的是我们抓了、这次抓成了、什么也没带回来', async () => {
    const rendered = await renderShipping();
    expect(rendered).toContain('国内这部分最近一次抓取');
    expect(rendered).toContain('但一条记录都没有取回来');
    expect(rendered).toContain(formatInstantAsDay('2026-08-14T00:03:31.000Z') as string);
    // 名单照画，去原站的门也照旧在。
    expect(rendered).toContain('A Study of Something in FSHD');
    expect(rendered).toContain('chinadrugtrials.org.cn');
  });

  it('不把登记库的零印成我们的缺席', async () => {
    const rendered = await renderShipping();
    expect(rendered).not.toContain('只收录');
    expect(rendered).not.toContain('不含仅在国内登记的试验');
    expect(rendered).not.toContain('国内这部分还没有抓取过');
  });

  it('也不替登记库回答「国内没有相关试验」', async () => {
    expect(await renderShipping()).toContain('这不等于国内就没有相关的试验');
  });
});

describe('名单本身', () => {
  it('招募中排在最前，默认展开；已完成的默认收起', async () => {
    mockListTrials.mockResolvedValue({
      trials: [
        trial({
          sourceId: 'NCT_DONE',
          title: 'A Finished Study',
          statusRaw: 'COMPLETED',
          statusZh: '已完成',
        }),
        trial({ sourceId: 'NCT_OPEN', title: 'An Open Study' }),
      ],
      sources: [sourceStatus({ recordCount: 2 })],
    });
    const rendered = screenText(await render());
    expect(rendered.indexOf('招募中')).toBeLessThan(rendered.indexOf('已完成或已停止'));
    expect(rendered).toContain('An Open Study');
    expect(rendered).not.toContain('A Finished Study');
  });

  it('收起的那一组点一下就展开', async () => {
    mockListTrials.mockResolvedValue({
      trials: [
        trial({
          sourceId: 'NCT_DONE',
          title: 'A Finished Study',
          statusRaw: 'COMPLETED',
          statusZh: '已完成',
        }),
      ],
      sources: [sourceStatus()],
    });
    const tree = await render();
    const toggle = buttonByLabel(tree, '已完成或已停止，1 项');
    expect(toggle.props['aria-expanded']).toBe(false);
    await act(async () => {
      toggle.props.onPress();
    });
    expect(screenText(tree)).toContain('A Finished Study');
    expect(buttonByLabel(tree, '已完成或已停止，1 项').props['aria-expanded']).toBe(true);
  });

  it('卡片上写的是注册库的事实，没有一句资格判断或疗效', async () => {
    mockListTrials.mockResolvedValue({
      trials: [trial({ countries: ['United States', 'China'] })],
      sources: [sourceStatus()],
    });
    const rendered = screenText(await render());
    expect(rendered).toContain('NCT00000001');
    expect(rendered).toContain('2 期');
    expect(rendered).toContain('Some Sponsor');
    expect(rendered).toContain('United States、China');
    expect(rendered).toContain('2026-06-01');
    expect(rendered).toContain('注册库列有中国站点');
    for (const forbidden of ['你可能符合', '适合你', '有效', '疗效', '建议参加']) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it('没有翻译的状态词原样显示英文，而且不藏在收起的组里', async () => {
    // ENROLLING_BY_INVITATION is 3 of the 92 rows cached on 2026-08-14
    // and those studies are still taking participants. §A4 forbids
    // guessing a Chinese word for it; it does not ask for the rows to
    // sit behind a shut toggle labelled 其他状态.
    mockListTrials.mockResolvedValue({
      trials: [trial({ statusRaw: 'ENROLLING_BY_INVITATION', statusZh: null })],
      sources: [sourceStatus()],
    });
    const tree = await render();
    const rendered = screenText(tree);
    expect(rendered).toContain('ENROLLING_BY_INVITATION');
    expect(rendered).toContain('A Study of Something in FSHD');
    expect(buttonByLabel(tree, '其他状态，1 项').props['aria-expanded']).toBe(true);
    // And the group says why its cards read in English.
    expect(rendered).toContain('没有固定的中文译法');
  });

  it('缺的字段写「注册库未标注」，不是空白', async () => {
    mockListTrials.mockResolvedValue({
      trials: [trial({ phase: null, sponsor: null, countries: [], sourceUpdatedAt: null })],
      sources: [sourceStatus()],
    });
    const rendered = screenText(await render());
    expect(rendered).toContain('注册库未标注');
    expect(rendered).toContain('注册库未提供');
  });

  it('原始记录的链接交给浏览器打开', async () => {
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const tree = await render();
    await act(async () => {
      buttonByLabel(tree, '在ClinicalTrials.gov上打开 NCT00000001 的原始记录').props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith('https://clinicaltrials.gov/study/NCT00000001');
  });
});

describe('触控目标', () => {
  it('分组开关是一个真的 48pt 盒子', () => {
    // react-native-web does not read `hitSlop` (see Button.tsx), so on
    // the export that ships the drawn box is the whole target. This is
    // the control that decides whether someone with limited arm
    // elevation has to scroll past the 52 closed studies in the cache
    // on 2026-08-14 (COMPLETED 45 + TERMINATED 7).
    expect(styles.groupHeader.minHeight).toBe(MIN_TOUCH_TARGET);
  });
});

describe('取不到的时候', () => {
  it('抓取失败导致的空名单，说的是抓取失败，不是「暂无试验」', async () => {
    mockListTrials.mockResolvedValue({
      trials: [],
      sources: [
        sourceStatus({
          recordCount: 0,
          // Null on purpose: an empty table has no `fetched_at` to
          // report. The screen must answer that with「抓取失败」and not
          // with its undated-list refusal, which would blame our own
          // rendering for the registry half of the problem.
          fetchedAt: null,
          lastRun: { startedAt: FETCHED_AT, finishedAt: '2026-08-12T02:00:03.000Z', ok: false },
          lastSuccessAt: '2026-08-01T00:00:05.000Z',
        }),
      ],
    });
    const rendered = screenText(await render());
    expect(rendered).toContain('这次没有取到任何记录');
    expect(rendered).toContain('没有取到');
    expect(rendered).not.toContain('这份名单没有抓取时间，暂不显示');
    expect(rendered).not.toContain('暂无');
  });

  it('请求本身失败时给出重试，并且不假装名单是空的', async () => {
    mockListTrials.mockRejectedValue(new Error('网络连接不稳定，请检查网络后重试'));
    const tree = await render();
    const rendered = screenText(tree);
    expect(rendered).toContain('暂时读不到试验名单');
    expect(rendered).toContain('网络连接不稳定，请检查网络后重试');
    expect(rendered).not.toContain('这次没有取到任何记录');

    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    await act(async () => {
      buttonByLabel(tree, '重新加载').props.onPress();
    });
    expect(screenText(tree)).toContain('A Study of Something in FSHD');
  });

  it('重新加载失败时，上一次的名单和它的日期一起清掉', async () => {
    // Keeping the old list under a stale 拉取于 date would be the page
    // vouching for records it can no longer re-read.
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const tree = await render();
    expect(screenText(tree)).toContain('A Study of Something in FSHD');

    mockListTrials.mockRejectedValue(new Error('boom'));
    await act(async () => {
      buttonByLabel(tree, '重新读取').props.onPress();
    });
    const rendered = screenText(tree);
    expect(rendered).not.toContain('A Study of Something in FSHD');
    expect(rendered).not.toContain(`拉取于 ${FETCHED_DAY}`);
    expect(rendered).toContain('暂时读不到试验名单');
  });
});

/**
 * 三件事各自变化，横幅却是同一批：国内那半边的抓取结果、境外那半边的
 * 抓取结果、名单到底有没有画到屏幕上。
 *
 * 前两件是 `describeChinaCoverage` 和 `describeCtgovStaleness` 一直在
 * 看的；第三件它们以前没看，而它们停的位置——名单上方——在空名单和
 * 「没有抓取时间」那两张卡片下面照样渲染。于是「下面这份名单目前只有
 * ClinicalTrials.gov 的记录」和「重要的试验请点开原始记录核对」会一起
 * 出现在一块什么都没有的屏幕上，互相还打架：一句说名单在下面，另一句
 * 让读者去点名单里的记录。
 *
 * 下面把三者铺开渲染，从树上把文案读回来。
 */
describe('组合起来时，屏幕上的每一句话都要成立', () => {
  type RunKind = 'ok' | 'failed' | 'unfinished' | 'never';

  /** `ok = false` 配 `finished_at` 为空是「跑了没回来」，和「跑完了但
   *  失败」是两句不同的话 —— 迁移 026 让前者只可能是这个意思。 */
  const runOf = (kind: RunKind) =>
    kind === 'never'
      ? null
      : {
          startedAt: '2026-08-13T02:00:00.000Z',
          finishedAt: kind === 'unfinished' ? null : '2026-08-13T02:00:30.000Z',
          ok: kind === 'ok',
        };

  const statusOf = (
    source: TrialSourceStatus['source'],
    kind: RunKind,
    overrides: Partial<TrialSourceStatus> = {},
  ): TrialSourceStatus =>
    sourceStatus({
      source,
      lastRun: runOf(kind),
      lastSuccessAt: kind === 'ok' ? '2026-08-13T02:00:30.000Z' : '2026-08-01T00:00:05.000Z',
      ...overrides,
    });

  const CN_TRIAL = 'A MAINLAND STUDY';
  const cnTrial = (overrides: Partial<TrialRecord> = {}): TrialRecord =>
    trial({
      source: 'chinadrugtrials',
      sourceId: 'CTR20250001',
      title: CN_TRIAL,
      url: 'http://www.chinadrugtrials.org.cn/CTR20250001',
      ...overrides,
    });

  type ListKind =
    | 'shown' // 只有境外记录，带得出抓取时间
    | 'shown-with-cn' // 两个来源的记录都在名单里
    | 'empty' // 一条都没有，也没有抓取时间
    | 'empty-dated' // 一条都没能读出来，来源块却还带着抓取时间
    | 'undated' // 记录回来了，没有一个可读的抓取时间
    | 'undated-with-cn'; // 同上，而且国内记录也在里面

  /** 名单真画到屏幕上的只有这两种。 */
  const DRAWS_A_LIST: ListKind[] = ['shown', 'shown-with-cn'];
  const DRAWS_NOTHING: ListKind[] = ['empty', 'empty-dated', 'undated', 'undated-with-cn'];

  const snapshotFor = (cn: RunKind, ctgov: RunKind, list: ListKind): TrialsSnapshot => {
    switch (list) {
      case 'shown':
        return {
          trials: [trial()],
          sources: [statusOf('ctgov', ctgov), statusOf('chinadrugtrials', cn, { recordCount: 0 })],
        };
      case 'shown-with-cn':
        return {
          trials: [trial(), cnTrial()],
          sources: [statusOf('ctgov', ctgov), statusOf('chinadrugtrials', cn)],
        };
      case 'empty':
        return {
          trials: [],
          sources: [
            statusOf('ctgov', ctgov, { recordCount: 0, fetchedAt: null }),
            statusOf('chinadrugtrials', cn, { recordCount: 0, fetchedAt: null }),
          ],
        };
      case 'empty-dated':
        // 服务端说它有记录，客户端一条都没解析出来（lib/trials-api.ts
        // 的 asTrialRecord）。名单是空的，抓取时间却还在来源块上。
        return {
          trials: [],
          sources: [
            statusOf('ctgov', ctgov, { recordCount: 92 }),
            statusOf('chinadrugtrials', cn, { recordCount: 0, fetchedAt: null }),
          ],
        };
      case 'undated':
        return {
          trials: [trial({ fetchedAt: null })],
          sources: [
            statusOf('ctgov', ctgov, { fetchedAt: null }),
            statusOf('chinadrugtrials', cn, { recordCount: 0, fetchedAt: null }),
          ],
        };
      default:
        return {
          trials: [trial({ fetchedAt: null }), cnTrial({ fetchedAt: null })],
          sources: [
            statusOf('ctgov', ctgov, { fetchedAt: null }),
            statusOf('chinadrugtrials', cn, { fetchedAt: null }),
          ],
        };
    }
  };

  /** 指着屏幕上的名单说话的句子。名单没画出来，一句都不该出现。 */
  const POINTS_AT_THE_LIST = [
    '下面这份名单',
    '请点开原始记录核对',
    '要点开原始记录才看得到',
    '本列表',
    '其中国内登记的试验',
    '国内这几条',
  ];

  const RUNS: RunKind[] = ['ok', 'failed', 'unfinished', 'never'];
  const cellsOf = (lists: ListKind[]) =>
    lists.flatMap((list) => RUNS.flatMap((cn) => RUNS.map((ctgov) => ({ list, cn, ctgov }))));

  const renderWith = async (snapshot: TrialsSnapshot) => {
    mockListTrials.mockResolvedValue(snapshot);
    return screenText(await render());
  };

  it.each(cellsOf(DRAWS_NOTHING))(
    '$list · 国内 $cn · 境外 $ctgov —— 名单没画出来，就没有一句话指着名单说',
    async ({ list, cn, ctgov }) => {
      const rendered = await renderWith(snapshotFor(cn, ctgov, list));
      expect(rendered).not.toContain('A Study of Something in FSHD');
      expect(rendered).not.toContain(CN_TRIAL);
      for (const phrase of POINTS_AT_THE_LIST) {
        expect(rendered).not.toContain(phrase);
      }
      // 但屏幕不是哑的：为什么什么都没有，一直有人在说。
      expect(rendered).toMatch(/这次没有取到任何记录|这份名单没有抓取时间，暂不显示/);
      // 而「去哪儿查」在每一格里都在。
      expect(rendered).toContain('chinadrugtrials.org.cn');
      expect(rendered).toContain('主诊医生');
    },
  );

  it.each(cellsOf(DRAWS_A_LIST))(
    '$list · 国内 $cn · 境外 $ctgov —— 名单画出来了，指着名单的话才成立',
    async ({ list, cn, ctgov }) => {
      const rendered = await renderWith(snapshotFor(cn, ctgov, list));
      expect(rendered).toContain('A Study of Something in FSHD');
      expect(rendered).toContain(`拉取于 ${FETCHED_DAY}`);

      // 境外那半边没抓成时，横幅在，并且报的是名单的日期。
      const ctgovStale = ctgov === 'failed' || ctgov === 'unfinished';
      expect(rendered.includes('请点开原始记录核对')).toBe(ctgovStale);
      if (ctgovStale) expect(rendered).toContain(`下面这份名单是 ${FETCHED_DAY} 抓到的`);

      // 「名单里只有 ClinicalTrials.gov 的记录」只在真是这样的时候说。
      const onlyCtgov = list === 'shown';
      if (rendered.includes('下面这份名单目前只有 ClinicalTrials.gov 的记录')) {
        expect(onlyCtgov).toBe(true);
      }
      if (!onlyCtgov) expect(rendered).toContain(CN_TRIAL);
    },
  );

  it('国内取不到、名单又是空的：不说名单里有什么，只说国内这次没取到和去哪儿查', async () => {
    // 这两句以前会同时出现在一块空屏幕上：一句说「下面这份名单目前只有
    // ClinicalTrials.gov 的记录」，另一句让读者去点名单里的记录。
    const rendered = await renderWith(snapshotFor('failed', 'failed', 'empty'));
    expect(rendered).toContain('国内这部分这次没有取到');
    expect(rendered).toContain('国内登记的试验请直接查');
    expect(rendered).not.toContain('下面这份名单目前只有 ClinicalTrials.gov 的记录');
    expect(rendered).not.toContain('请点开原始记录核对');
    // 空名单那张卡片自己把话说完了，没落下上次成功抓取的日期。
    expect(rendered).toContain('注册库这次没有取到');
    expect(rendered).toContain(`上次成功抓取：${formatInstantAsDay('2026-08-01T00:00:05.000Z')}`);
  });

  it('一条记录都没解析出来时，不在空屏幕上方挂一个「拉取于」', async () => {
    // 来源块带着 fetched_at，名单却是空的。日期属于一份没画出来的名单，
    //「这一页是我们在那一天抄下来的副本」下面什么都没有。
    const rendered = await renderWith(snapshotFor('ok', 'ok', 'empty-dated'));
    expect(rendered).not.toContain('拉取于');
    expect(rendered).not.toContain('要点开原始记录才看得到');
    expect(rendered).toContain('没有一条记录能完整读出来');
  });

  it('名单读回来了但没有抓取时间时，横幅不越过那张拒绝显示的卡片', async () => {
    const rendered = await renderWith(snapshotFor('ok', 'failed', 'undated'));
    expect(rendered).toContain('这份名单没有抓取时间，暂不显示');
    expect(rendered).not.toContain('最近一次更新没有成功');
    expect(rendered).not.toContain('请点开原始记录核对');
  });
});

describe('境外那半边过期时', () => {
  it('横幅真的渲染出来，说明名单停在哪一天', async () => {
    // The only thing on screen saying the ClinicalTrials.gov half
    // stopped refreshing. `describeCtgovStaleness` is unit-tested five
    // ways in lib/__tests__/trials.test.ts; this is the wiring.
    mockListTrials.mockResolvedValue({
      trials: [trial()],
      sources: [
        sourceStatus({
          lastRun: {
            startedAt: '2026-08-13T02:00:00.000Z',
            finishedAt: '2026-08-13T02:00:30.000Z',
            ok: false,
          },
          lastSuccessAt: '2026-08-12T02:00:03.000Z',
        }),
      ],
    });
    const rendered = screenText(await render());
    expect(rendered).toContain('最近一次更新没有成功');
    expect(rendered).toContain('注册库上此后的变化不会反映在这里');
    // Above the list, like every other sentence that frames it.
    expect(rendered.indexOf('最近一次更新没有成功')).toBeLessThan(
      rendered.indexOf('A Study of Something in FSHD'),
    );
  });
});

describe('这一页说了自己是什么', () => {
  it('入组资格和试验结果这两条边界写在名单之前', async () => {
    // §A5's two refusals. Without this the string could be deleted from
    // the screen and every other test would stay green.
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const rendered = screenText(await render());
    expect(rendered).toContain('本页不判断你是否符合入组条件，也不介绍试验结果');
    expect(rendered.indexOf('本页不判断你是否符合入组条件')).toBeLessThan(
      rendered.indexOf('A Study of Something in FSHD'),
    );
  });

  it('重新读取说明自己不会去访问注册库', async () => {
    // The button's wording is only defensible because the hint says
    // what it actually does: re-read our own copy.
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const tree = await render();
    expect(buttonByLabel(tree, '重新读取').props.accessibilityHint).toContain(
      '不会现在去访问注册库',
    );
  });

  it('能选中的是要发给医生的那两个字符串', async () => {
    // No `hitSlop`, no long-press menu of our own: on the web export
    // the only way to get the registry title or the NCT number into a
    // message is to select the text.
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const tree = await render();
    const selectable = tree.root
      .findAll((node) => String(node.type) === 'Text' && node.props?.selectable === true)
      .flatMap((node) => node.children)
      .filter((child): child is string => typeof child === 'string');
    expect(selectable).toContain('A Study of Something in FSHD');
    expect(selectable).toContain('NCT00000001');
  });
});

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
 * 3. Printing「不含仅在国内登记的试验」over a list that does contain
 *    them.
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
import { formatInstantAsDay, type TrialRecord, type TrialSourceStatus } from '../../../lib/trials';

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
  it('名单里没有国内记录时，说不含仅在国内登记的试验，并给出去哪里查', async () => {
    mockListTrials.mockResolvedValue({ trials: [trial()], sources: [sourceStatus()] });
    const rendered = screenText(await render());
    expect(rendered).toContain('不含仅在国内登记的试验');
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
    expect(rendered).toContain('不含仅在国内登记的试验');
    expect(rendered).toContain('主诊医生');
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

import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import ManageScreen from '../index';

/**
 * The falls count on 病程, and the door to the diary.
 *
 * Before the diary existed there was nowhere to record a fall except a
 * free-text followup event that the AI retriever is required to refuse,
 * so this block is the whole feature's front door — a screen nobody can
 * reach is a screen that does not exist.
 *
 * Three things it must get right:
 *
 *  1. It is CONTEXT, not a headline. One number and its caveat, never a
 *     quarter-to-quarter comparison. A running total with an arrow on
 *     it is a progression alert, and 病程 is where a patient goes to
 *     see how they are doing.
 *  2. A failed read is not a zero. 「还没有跌倒记录」 rendered because
 *     the fetch died is the app telling someone they have not fallen.
 *  3. A falls outage must not blank the page. The block is fetched
 *     best-effort, after the main payload.
 */

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockPush = jest.fn();
const mockFocusCallbacks = new Set<() => unknown>();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    useFocusEffect: (callback: () => unknown) => {
      mockFocusCallbacks.add(callback);
      React.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? (cleanup as () => void) : undefined;
      }, [callback]);
    },
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('react-native-chart-kit', () => ({ LineChart: () => null }));
jest.mock('../../common/AskAboutDrawer', () => () => null);
jest.mock('../../common/HumanBodyFigure', () => () => null);
jest.mock('../../common/SystemMonitoringPanels', () => () => null);
jest.mock('../../common/TimelineSectionCard', () => () => null);

const mockGetFallsSummary = jest.fn();
jest.mock('../../../lib/falls-api', () => ({
  __esModule: true,
  getFallsSummary: (...args: unknown[]) => mockGetFallsSummary(...args),
}));

jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  addMedication: jest.fn(),
  getMyPatientProfile: jest.fn(() => Promise.resolve(null)),
  getProgressionSummary: jest.fn(() =>
    Promise.resolve({
      currentStatus: { headline: '状态平稳', detail: '继续记录。', lastFollowupAt: null },
      changeCards: [],
      recommendedReviewItems: [],
    }),
  ),
  getRiskSummary: jest.fn(() => Promise.resolve({ overallLevel: 'low', notes: [] })),
  getMuscleInsight: jest.fn(() => Promise.reject(new Error('no cohort'))),
}));

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ManageScreen />);
  });
  return tree;
};

const allText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' | ');

const openFalls = (tree: TestRenderer.ReactTestRenderer) => {
  const button = tree.root.findAll(
    (node: ReactTestInstance) =>
      node.props.accessibilityRole === 'button' &&
      ['打开跌倒记录', '记一次跌倒'].includes(node.props.accessibilityLabel),
  )[0];
  act(() => {
    button.props.onPress();
  });
};

beforeEach(() => {
  mockFocusCallbacks.clear();
  mockPush.mockClear();
  mockGetFallsSummary.mockReset();
});

describe('the door to the diary', () => {
  it('routes to /p-falls', async () => {
    mockGetFallsSummary.mockResolvedValue({
      total: 0,
      atCap: false,
      quarters: [],
      oldestDaysAgo: null,
    });
    const tree = await render();
    openFalls(tree);
    expect(mockPush).toHaveBeenCalledWith('/p-falls');
  });

  it('asks for the same window it is going to print', async () => {
    mockGetFallsSummary.mockResolvedValue({
      total: 0,
      atCap: false,
      quarters: [],
      oldestDaysAgo: null,
    });
    await render();
    expect(mockGetFallsSummary).toHaveBeenCalledWith(180);
  });
});

describe('one number, and what it is allowed to mean', () => {
  it('shows the recent quarter without the buckets behind it', async () => {
    mockGetFallsSummary.mockResolvedValue({
      total: 5,
      atCap: false,
      quarters: [
        { index: 0, startDaysAgo: 0, endDaysAgo: 89, count: 2 },
        { index: 1, startDaysAgo: 90, endDaysAgo: 179, count: 3 },
      ],
      oldestDaysAgo: 140,
    });
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('最近 90 天记录到 2 次跌倒');
    expect(text).toContain('不能当作没有跌倒');
    // No 「2 次、3 次」 comparison: that clause exists on the API for
    // the assistant to reason over when asked, not for this page.
    expect(text).not.toContain('3 次跌倒');
  });

  it('an empty diary says the blank is a blank', async () => {
    mockGetFallsSummary.mockResolvedValue({
      total: 0,
      atCap: false,
      quarters: [],
      oldestDaysAgo: null,
    });
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('还没有跌倒记录。');
    expect(text).toContain('不代表没有跌倒过');
    expect(text).not.toMatch(/0 次/);
  });
});

describe('a falls outage', () => {
  it('says it could not read rather than printing a zero', async () => {
    mockGetFallsSummary.mockRejectedValue(new Error('boom'));
    const tree = await render();
    const text = allText(tree);

    expect(text).toContain('这会儿读不到跌倒记录');
    expect(text).not.toContain('还没有跌倒记录');
  });

  it('an unparseable summary is treated the same as a failed fetch', async () => {
    // falls-api returns null when the body carried no readable count.
    mockGetFallsSummary.mockResolvedValue(null);
    const tree = await render();
    expect(allText(tree)).toContain('这会儿读不到跌倒记录');
  });

  it('does not blank the rest of 病程', async () => {
    mockGetFallsSummary.mockRejectedValue(new Error('boom'));
    const tree = await render();
    // The page's own error state would replace every panel; the falls
    // block is fetched in its own catch precisely so it cannot.
    expect(allText(tree)).toContain('状态平稳');
    expect(allText(tree)).not.toContain('暂时无法加载病程管理页');
  });
});

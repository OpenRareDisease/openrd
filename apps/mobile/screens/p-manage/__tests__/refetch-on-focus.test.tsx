import TestRenderer, { act } from 'react-test-renderer';
import ManageScreen from '../index';

/**
 * 病程 is a tab and stays mounted for the session, so a mount-only
 * fetch left 最近记录 / 变化摘要 / the curves showing whatever the
 * server said when the app opened. Pull-to-refresh cannot cover for it
 * on the platform this ships to: react-native-web's RefreshControl is
 * an empty shell, and WeChat's browser has no address bar to reload
 * from. Regaining focus is the refresh.
 */

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockPush = jest.fn();
/** Every callback the screen has handed to useFocusEffect. This screen
 *  registers two — the data load and the tab reset — and a focus gain
 *  runs both, so the test fires the whole set rather than guessing
 *  which is which. */
const mockFocusCallbacks = new Set<() => unknown>();

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    // expo-router runs the effect on the initial mount too, which is
    // why the screen has no separate mount effect.
    useFocusEffect: (callback: () => unknown) => {
      mockFocusCallbacks.add(callback);
      React.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? (cleanup as () => void) : undefined;
      }, [callback]);
    },
  };
});

/** Simulate the tab regaining focus. */
const refocus = async () => {
  await act(async () => {
    for (const callback of mockFocusCallbacks) callback();
  });
};

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

const mockGetMyPatientProfile = jest.fn();
const mockGetProgressionSummary = jest.fn();
const mockGetRiskSummary = jest.fn();
const mockGetMuscleInsight = jest.fn();
// Replaced wholesale: lib/api reaches AsyncStorage through
// session-storage, whose native module does not exist under jest.
jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  addMedication: jest.fn(),
  getMyPatientProfile: (...args: unknown[]) => mockGetMyPatientProfile(...args),
  getProgressionSummary: (...args: unknown[]) => mockGetProgressionSummary(...args),
  getRiskSummary: (...args: unknown[]) => mockGetRiskSummary(...args),
  getMuscleInsight: (...args: unknown[]) => mockGetMuscleInsight(...args),
}));

const summaryWith = (changeCards: Array<{ id: string; title: string; detail: string }>) => ({
  currentStatus: { headline: '状态平稳', detail: '继续记录。', lastFollowupAt: null },
  changeCards: changeCards.map((card) => ({ ...card, trend: 'stable' as const })),
  recommendedReviewItems: [],
});

const renderScreen = async () => {
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

describe('p-manage refetches when the tab regains focus', () => {
  beforeEach(() => {
    mockFocusCallbacks.clear();
    mockPush.mockClear();
    mockGetMyPatientProfile.mockReset().mockResolvedValue(null);
    mockGetRiskSummary.mockReset().mockResolvedValue({ overallLevel: 'low', notes: [] });
    mockGetMuscleInsight.mockReset().mockRejectedValue(new Error('no cohort'));
    mockGetProgressionSummary.mockReset();
  });

  it('loads once on mount', async () => {
    mockGetProgressionSummary.mockResolvedValue(summaryWith([]));
    await renderScreen();
    expect(mockGetProgressionSummary).toHaveBeenCalledTimes(1);
    expect(mockGetRiskSummary).toHaveBeenCalledTimes(1);
  });

  it('refetches on every later focus gain', async () => {
    mockGetProgressionSummary.mockResolvedValue(summaryWith([]));
    await renderScreen();

    expect(mockFocusCallbacks.size).toBeGreaterThan(0);
    await refocus();

    expect(mockGetProgressionSummary).toHaveBeenCalledTimes(2);
    expect(mockGetRiskSummary).toHaveBeenCalledTimes(2);
  });

  it('shows the change recorded since the page was last on screen', async () => {
    mockGetProgressionSummary.mockResolvedValueOnce(summaryWith([]));
    const tree = await renderScreen();
    expect(allText(tree)).toContain('再记一次日常数据');

    mockGetProgressionSummary.mockResolvedValueOnce(
      summaryWith([{ id: 'c1', title: '爬楼时间变长', detail: '比上次慢了 2 秒' }]),
    );
    await refocus();

    expect(allText(tree)).toContain('爬楼时间变长');
    expect(allText(tree)).not.toContain('再记一次日常数据');
  });
});

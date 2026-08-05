import TestRenderer, { act } from 'react-test-renderer';
import HomeScreen from '../index';

/**
 * 今天 is a tab: it mounts once and stays mounted for the whole
 * session. A mount-only fetch therefore pinned the brief to whatever
 * the server said when the app opened — record a followup, come back,
 * and 记录节奏 still counts the days from the older reading.
 *
 * Pull-to-refresh is not a fallback here. react-native-web ships
 * RefreshControl as an empty shell, so the gesture does nothing on the
 * platform this product actually ships to, and WeChat's in-app browser
 * has no address bar to reload from. Refocusing the tab is the only
 * refresh a patient has, so it has to be the one that refetches.
 */

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

// `mock`-prefixed so jest's out-of-scope guard allows the factories
// below to close over them.
const mockPush = jest.fn();
/** The most recent callback the screen handed to useFocusEffect.
 *  Calling it is this test's stand-in for the tab regaining focus. */
let mockRefocus: (() => void) | null = null;

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: mockPush, replace: jest.fn() }),
    // expo-router fires the effect on the initial mount as well as on
    // every later focus gain; the screen relies on that (it has no
    // separate mount effect), so the mock has to do it too.
    useFocusEffect: (callback: () => void) => {
      mockRefocus = callback;
      React.useEffect(() => {
        callback();
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

// The drawer opens a real SSE client; nothing in this test presses it.
jest.mock('../../common/AskAboutDrawer', () => () => null);

const mockGetMyPatientProfile = jest.fn();
const mockGetProgressionSummary = jest.fn();
// Replaced wholesale rather than spied on: lib/api pulls in
// session-storage → AsyncStorage, whose native module does not exist
// under jest.
jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  getMyPatientProfile: (...args: unknown[]) => mockGetMyPatientProfile(...args),
  getProgressionSummary: (...args: unknown[]) => mockGetProgressionSummary(...args),
}));

const summaryWithLastFollowup = (lastFollowupAt: string | null) => ({
  currentStatus: {
    headline: '本周状态平稳',
    detail: '继续保持记录。',
    lastFollowupAt,
  },
  changeCards: [],
  recommendedReviewItems: [],
});

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

const renderScreen = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<HomeScreen />);
  });
  return tree;
};

/** Every string rendered anywhere in the tree, flattened. */
const allText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' | ');

describe('p-home refetches when the tab regains focus', () => {
  beforeEach(() => {
    mockRefocus = null;
    mockPush.mockClear();
    mockGetMyPatientProfile.mockReset().mockResolvedValue(null);
    mockGetProgressionSummary.mockReset();
  });

  it('loads once on mount', async () => {
    mockGetProgressionSummary.mockResolvedValue(summaryWithLastFollowup(null));
    await renderScreen();
    // Exactly once: expo-router fires the focus effect on mount, so a
    // separate mount effect would double every entry's fetch.
    expect(mockGetProgressionSummary).toHaveBeenCalledTimes(1);
    expect(mockGetMyPatientProfile).toHaveBeenCalledTimes(1);
  });

  it('refetches on every later focus gain', async () => {
    mockGetProgressionSummary.mockResolvedValue(summaryWithLastFollowup(null));
    await renderScreen();

    expect(mockRefocus).not.toBeNull();
    await act(async () => {
      mockRefocus!();
    });

    expect(mockGetProgressionSummary).toHaveBeenCalledTimes(2);
    expect(mockGetMyPatientProfile).toHaveBeenCalledTimes(2);
  });

  it('shows the newly recorded followup instead of the stale count', async () => {
    // The scenario: the patient last recorded three days ago, opens
    // 记录数据, saves today's entry, and taps 今天. The screen must not
    // still be saying「距上次记录 3 天」.
    mockGetProgressionSummary.mockResolvedValueOnce(summaryWithLastFollowup(isoDaysAgo(3)));
    const tree = await renderScreen();
    expect(allText(tree)).toContain('距上次记录 3 天');

    mockGetProgressionSummary.mockResolvedValueOnce(
      summaryWithLastFollowup(new Date().toISOString()),
    );
    await act(async () => {
      mockRefocus!();
    });

    expect(allText(tree)).toContain('今天已经记录过了');
    expect(allText(tree)).not.toContain('距上次记录 3 天');
  });
});

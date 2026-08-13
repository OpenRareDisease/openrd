/**
 * 报告管理 keeps its navigation on screen.
 *
 * Same defect as 我的档案: ScreenHeader — back, title, home — was the
 * first child of the ScrollView, and this screen is not a tab screen,
 * so that header is the only navigation surface on the page. This one
 * is worse for length: it is a list of every report a patient has ever
 * uploaded, so it grows without bound, and the further along a patient
 * is the further they had to fling back up to find a way out.
 *
 * p-data_entry already solved this by hoisting the header out of the
 * ScrollView. This pins that shape here: one header, and no header
 * anywhere inside a scroller.
 */

import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView } from 'react-native';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    // Never settling keeps the screen in its initial loading state, so
    // the test asserts structure without racing the focus effect. The
    // header and the ScrollView both render regardless — neither is
    // behind an early return, and that is part of what makes the
    // header trustworthy as an exit.
    getMyPatientProfile: jest.fn(() => new Promise(() => {})),
    deletePatientDocument: jest.fn(() => new Promise(() => {})),
  };
});

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
// Icon.tsx renders Ionicons, which asynchronously loads its font and
// setStates outside act(). Stubbed to a host string: these tests are
// about layout, not glyphs.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      canGoBack: () => true,
    }),
    // The screen passes a useCallback-stable function, so running it
    // through useEffect reproduces the real mount behaviour.
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn(async () => false) }),
}));

import ReportManagementScreen from '../index';
import ScreenHeader from '../../common/ScreenHeader';

const render = (): TestRenderer.ReactTestRenderer => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ReportManagementScreen />);
  });
  return tree;
};

describe('报告管理 navigation surface', () => {
  it('renders exactly one ScreenHeader', () => {
    expect(render().root.findAllByType(ScreenHeader)).toHaveLength(1);
  });

  it('keeps it outside every ScrollView, so scrolling cannot remove it', () => {
    const tree = render();
    const scrollViews = tree.root.findAllByType(ScrollView);
    // Guards the assertion below from passing vacuously if the screen
    // ever stops using a ScrollView at all.
    expect(scrollViews.length).toBeGreaterThan(0);
    for (const scrollView of scrollViews) {
      expect(scrollView.findAllByType(ScreenHeader)).toHaveLength(0);
    }
  });

  it('still offers both back and home, and back still falls back to 首页', () => {
    const tree = render();
    const header = tree.root.findAllByType(ScreenHeader)[0];
    // A deep link opened cold has nothing to pop; without this a
    // patient arriving from a forwarded link had a back button that
    // did nothing.
    expect(header.props.fallbackHref).toBe('/p-home');

    const labels = tree.root
      .findAll(
        (node) =>
          node.props?.accessibilityRole === 'button' &&
          typeof node.props?.accessibilityLabel === 'string',
        { deep: false },
      )
      .map((node) => node.props.accessibilityLabel as string);
    expect(labels).toContain('返回上一页');
    expect(labels).toContain('回到首页');
  });
});

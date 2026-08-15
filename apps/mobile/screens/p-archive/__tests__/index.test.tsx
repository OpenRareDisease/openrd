/**
 * 我的档案 keeps its navigation on screen.
 *
 * ScreenHeader — back, title, home — used to be the first child of
 * this screen's ScrollView. The archive is not a tab screen: the root
 * Stack runs headerShown:false and AppTabBar does not render here, so
 * that header is the *only* navigation surface on the page. Inside the
 * scroller it scrolled away with everything else, and this page is
 * long (hero record, data-asset console, nav list, visualisation
 * digest). A patient a few hundred points down had no back and no home
 * and had to fling all the way to the top to find one — a repeated
 * flick gesture, on the population least able to make it.
 *
 * p-data_entry already solved this by hoisting the header out of the
 * ScrollView. This pins that shape here: one header, and no header
 * anywhere inside a scroller.
 */

import TestRenderer, { act } from 'react-test-renderer';
import { ScrollView } from 'react-native';

// api.ts reaches AsyncStorage through session-storage, which has no
// native module under jest.
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../lib/api', () => {
  // The two requests are stubbed; everything else the screen reads out
  // of this module — `readPassportValueOrigins`, which decides whether
  // a value prints its source — stays the shipped implementation.
  const actual = jest.requireActual('../../../lib/api');
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ...actual,
    ApiError,
    // Never settling keeps the screen in its initial loading state, so
    // the test asserts structure without racing the effect. The header
    // and the ScrollView both render regardless — neither is behind an
    // early return, and that is itself part of what makes the header
    // trustworthy as an exit.
    getMyPatientProfile: jest.fn(() => new Promise(() => {})),
    getClinicalPassportSummary: jest.fn(() => new Promise(() => {})),
  };
});

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
// Icon.tsx renders Ionicons, which asynchronously loads its font and
// setStates outside act(). Stubbed to a host string: these tests are
// about layout and copy, not glyphs.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

import ArchiveScreen from '../index';
import ScreenHeader from '../../common/ScreenHeader';

const render = (): TestRenderer.ReactTestRenderer => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ArchiveScreen />);
  });
  return tree;
};

describe('我的档案 navigation surface', () => {
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

  it('still offers both back and home', () => {
    const labels = render()
      .root.findAll(
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

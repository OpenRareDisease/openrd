/**
 * 谁现在能看我的记录 — the list of open doors, and the button that
 * closes one.
 *
 * Two failures, both of them about a patient who is standing in front
 * of a doctor:
 *
 * 1. The row is frozen. `describePickupState` and `isShareRowLive`
 *    sample the clock at RENDER time, and nothing re-renders this
 *    screen on its own — so a pickup code that died while the screen
 *    was open kept claiming minutes and kept offering 作废, three
 *    centimetres below a card that had already said 已过期.
 * 2. The button is 34pt. 撤销/作废 is the control that takes back
 *    access to a medical record, and `compact` draws it at 34pt on the
 *    web export, where `hitSlop` buys nothing back (Button.tsx).
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../../../lib/api', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  getLegalAcceptances: () => Promise.resolve({ acceptances: [] }),
  withdrawLegalAcceptance: () => Promise.resolve(undefined),
  getMyConsent: () => Promise.reject(new Error('not part of this test')),
  getMySharingPreferences: () => Promise.reject(new Error('not part of this test')),
  getSubmissionTimeline: () => Promise.resolve({ total: 0 }),
  updateMyConsent: () => Promise.resolve(undefined),
  updateMySharingPreferences: () => Promise.resolve(undefined),
}));

const mockListShares = jest.fn();
const mockRevokeShare = jest.fn();
jest.mock('../../../lib/passport-share-api', () => ({
  __esModule: true,
  listPassportShares: (...args: unknown[]) => mockListShares(...args),
  revokePassportShare: (...args: unknown[]) => mockRevokeShare(...args),
  createPassportShare: jest.fn(),
  createPassportPickup: jest.fn(),
}));

jest.mock('../../../lib/consent-epoch', () => ({ __esModule: true, bumpConsentEpoch: jest.fn() }));

const mockConfirm = jest.fn();
jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ confirm: mockConfirm, notify: jest.fn() }),
}));

jest.mock('expo-router', () => ({ __esModule: true, useRouter: () => ({ push: jest.fn() }) }));

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

jest.mock('../../common/ToggleSwitch', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ToggleSwitch', null) };
});

// The card has its own clock and its own test; here it would only drag
// in react-native-svg.
jest.mock('../components/PickupCodeCard', () => ({ __esModule: true, default: () => null }));

/**
 * Rendered as a host element carrying every prop, so the assertions can
 * read `compact` — the whole point of one of them — rather than trusting
 * a stand-in that quietly drops it.
 */
jest.mock('../../common/Button', () => {
  const ReactLocal = require('react');
  const { Text: RNText } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      ReactLocal.createElement(
        'MockButton',
        props,
        ReactLocal.createElement(RNText, null, String(props.label ?? '')),
      ),
  };
});

import PrivacySettingsScreen from '../index';

const iso = (msFromNow: number): string => new Date(Date.now() + msFromNow).toISOString();

const pickupShare = (minutesLeft: number) => ({
  id: 'p1',
  label: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: iso(minutesLeft * 60_000),
  revokedAt: null,
  openedCount: 0,
  lastOpenedAt: null,
  pickup: {
    expiresAt: iso(minutesLeft * 60_000),
    attempts: 0,
    redeemedAt: null,
    burnedAt: null,
  },
});

const texts = (tree: TestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .flatMap((node) =>
      Array.isArray(node.props.children) ? node.props.children : [node.props.children],
    )
    .filter((child): child is string => typeof child === 'string');

const revokeButtons = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      String(node.type) === 'MockButton' &&
      (node.props.label === '作废' || node.props.label === '撤销'),
  );

/** Unmounted in afterEach: the screen holds a live interval while a
 *  pickup row is live, and a leaked one keeps ticking into the next
 *  test's renderer. */
let mounted: TestRenderer.ReactTestRenderer | null = null;

const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PrivacySettingsScreen />);
  });
  mounted = tree;
  return tree;
};

beforeEach(() => {
  mockListShares.mockReset().mockResolvedValue([]);
  mockRevokeShare.mockReset().mockResolvedValue(undefined);
  mockConfirm.mockReset().mockResolvedValue(true);
});

afterEach(() => {
  if (mounted) {
    act(() => {
      mounted!.unmount();
    });
    mounted = null;
  }
});

describe('取件码那一行的钟要走', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('过期之后，那一行不再报剩余分钟，也不再给作废按钮', async () => {
    mockListShares.mockResolvedValue([pickupShare(2)]);
    const tree = await render();

    expect(texts(tree).join(' ')).toContain('还能用约 2 分钟');
    expect(revokeButtons(tree)).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(3 * 60_000);
    });

    const after = texts(tree).join(' ');
    expect(after).toContain('已过期');
    expect(after).not.toContain('还能用约');
    // A door that is shut must not be offered a button that closes it:
    // the patient presses it, and either the server revokes a code that
    // was already dead or she trusts the row and reads out a code that
    // opens nothing.
    expect(revokeButtons(tree)).toHaveLength(0);
  });

  it('剩余分钟会自己往下走，不是停在打开这一屏的那一刻', async () => {
    mockListShares.mockResolvedValue([pickupShare(10)]);
    const tree = await render();
    expect(texts(tree).join(' ')).toContain('还能用约 10 分钟');

    await act(async () => {
      jest.advanceTimersByTime(5 * 60_000);
    });
    expect(texts(tree).join(' ')).toContain('还能用约 5 分钟');
  });
});

describe('撤销/作废是一个手指够得着的目标', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('不是 compact —— 那在 web 上是 34pt', async () => {
    mockListShares.mockResolvedValue([pickupShare(10)]);
    const tree = await render();
    const button = revokeButtons(tree)[0];
    expect(button).toBeDefined();
    // Button.tsx: compact draws 34pt and its hitSlop is not read by
    // Pressable on react-native-web, which is the only channel that
    // ships. MIN_TOUCH_TARGET is 48.
    expect(button.props.compact).toBeFalsy();
  });
});

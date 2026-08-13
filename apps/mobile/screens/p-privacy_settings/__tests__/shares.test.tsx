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
 *    centimetres below a card that had already said 已过期. The first
 *    repair gave the screen a ticking clock but only installed it when
 *    the list held a pickup row, so a list of nothing but links — the
 *    common case, since a link is the feature most patients use — was
 *    still read against the mount-time clock. Hence the link-row cases
 *    below: the clock has to run for whatever kind of door is open.
 * 2. The button is too small. 撤销/作废 is the control that takes back
 *    access to a medical record, and it has to be at least
 *    MIN_TOUCH_TARGET in BOTH dimensions on the web export, where
 *    `hitSlop` buys nothing back (Button.tsx). `Button` is deliberately
 *    NOT mocked in this file: the earlier version of this test asserted
 *    that the `compact` prop was absent, which pins the one route to a
 *    small target that happened to occur and stays green for every
 *    other one. What is measured here is the box the screen actually
 *    draws.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';

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

/**
 * A render counter, not just a stub. ScreenHeader is rendered
 * unconditionally at the top of the screen and is not memoised, so it
 * runs exactly once per render of the screen — which is the quantity
 * the tick's bail-out exists to keep down and the only one that can
 * tell「the clock sampled」apart from「the screen re-rendered」.
 */
const mockHeaderRenders = { count: 0 };
jest.mock('../../common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return {
    __esModule: true,
    default: () => {
      mockHeaderRenders.count += 1;
      return ReactLocal.createElement('ScreenHeader', null);
    },
  };
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

/** A plain share link — no pickup code. This is what the list holds for
 *  a patient who only ever pressed 生成一个给医生看的链接. */
const linkShare = (minutesLeft: number, id = 'l1') => ({
  id,
  label: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: iso(minutesLeft * 60_000),
  revokedAt: null,
  openedCount: 0,
  lastOpenedAt: null,
  pickup: null,
});

/** The default a patient actually gets from 生成一个给医生看的链接:
 *  seven days, so day-granular for six of them. */
const dayLinkShare = (daysLeft: number, id = 'l7') => linkShare(daysLeft * 24 * 60, id);

const texts = (tree: TestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .flatMap((node) =>
      Array.isArray(node.props.children) ? node.props.children : [node.props.children],
    )
    .filter((child): child is string => typeof child === 'string');

/**
 * The pressable the row draws for 撤销/作废.
 *
 * Matched the way p-login_register's touch test matches controls:
 * `onPressIn` is what tells the real pressable apart from the `Button`
 * wrapper above it, which receives the same accessibilityLabel.
 */
const revokeButtons = (tree: TestRenderer.ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll(
    (node) =>
      (node.props?.accessibilityLabel === '作废' || node.props?.accessibilityLabel === '撤销') &&
      typeof node.props?.onPressIn === 'function',
    { deep: false },
  );

/** The box the control is drawn as, which on the web export is the box
 *  a finger has to hit — `hitSlop` is not read there (Button.tsx). */
const drawnBox = (node: ReactTestInstance): { width: number; height: number } => {
  const flattened = StyleSheet.flatten(node.props.style as never) as {
    minHeight?: number;
    height?: number;
    minWidth?: number;
    width?: number;
  };
  return {
    width: flattened.width ?? flattened.minWidth ?? 0,
    height: flattened.height ?? flattened.minHeight ?? 0,
  };
};

/** Unmounted in afterEach: the screen holds a live interval while any
 *  row is live, and a leaked one keeps ticking into the next test's
 *  renderer. */
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
  mockHeaderRenders.count = 0;
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

describe('只有链接、没有取件码时，钟一样要走', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('链接那一行的剩余时间自己往下走', async () => {
    mockListShares.mockResolvedValue([linkShare(30)]);
    const tree = await render();
    expect(texts(tree).join(' ')).toContain('约 30 分钟后过期');

    await act(async () => {
      jest.advanceTimersByTime(20 * 60_000);
    });
    expect(texts(tree).join(' ')).toContain('约 10 分钟后过期');
  });

  it('链接在屏幕开着的时候过期，那一行改口，撤销按钮也收回去', async () => {
    // The patient who reads this row is about to tell a doctor on the
    // phone whether the link still works. A row that keeps its
    // pre-expiry wording — and keeps offering 撤销 — answers that
    // question wrong.
    mockListShares.mockResolvedValue([linkShare(5)]);
    const tree = await render();
    expect(texts(tree).join(' ')).toContain('约 5 分钟后过期');
    expect(revokeButtons(tree)).toHaveLength(1);

    await act(async () => {
      jest.advanceTimersByTime(6 * 60_000);
    });

    const after = texts(tree).join(' ');
    expect(after).toContain('已过期');
    expect(after).not.toContain('分钟后过期');
    expect(revokeButtons(tree)).toHaveLength(0);
  });

  it('列表姗姗来迟时，那一行按到达的时刻读，不是按打开这一屏的时刻', async () => {
    // `now` is sampled at mount; the list is fetched at mount and
    // arrives whenever the network lets it — on a hospital's wifi that
    // can be minutes. If every row that arrives is already terminal the
    // effect installs no interval, so the first reading is also the
    // last: read against the mount-time clock the row says 「约 2 分钟后
    // 过期」 and draws 撤销 on a link that is already dead, and nothing
    // will ever correct it. That is what the `advanceTo` before the
    // interval is for, and it is invisible to every other test here
    // because they all get their list back in the same millisecond they
    // asked for it.
    const dead = linkShare(2);
    let deliver!: (rows: unknown[]) => void;
    mockListShares.mockReturnValue(
      new Promise((resolve) => {
        deliver = resolve;
      }),
    );
    const tree = await render();

    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000);
    });
    await act(async () => {
      deliver([dead]);
    });

    const after = texts(tree).join(' ');
    expect(after).toContain('已过期');
    expect(after).not.toContain('分钟后过期');
    expect(revokeButtons(tree)).toHaveLength(0);
  });

  it('取件码先死掉，还活着的链接不跟着一起停', async () => {
    // The mixed list is the case a pickup-only clock gets wrong last:
    // it ticks until the code dies, then stops with a live link row
    // still on screen, frozen at whatever the code's last second said.
    mockListShares.mockResolvedValue([pickupShare(2), linkShare(30)]);
    const tree = await render();
    expect(texts(tree).join(' ')).toContain('约 30 分钟后过期');

    await act(async () => {
      jest.advanceTimersByTime(3 * 60_000);
    });
    expect(revokeButtons(tree)).toHaveLength(1); // the link only

    await act(async () => {
      jest.advanceTimersByTime(20 * 60_000);
    });
    expect(texts(tree).join(' ')).toContain('约 7 分钟后过期');

    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000);
    });
    expect(revokeButtons(tree)).toHaveLength(0);
  });
});

/**
 * The two halves of「it ticks while a door is open」that the wording
 * tests above cannot see, because both are about what the screen does
 * when the text does NOT change.
 */
describe('钟只在该走的时候走，也只在该停的时候停', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // Both row kinds, because the stop is one condition over a mixed list
  // and a pickup-only fixture pins only the half that already had it.
  // The link is the row this change brought into the interval's scope —
  // and a list of nothing but links is the common case, since most
  // patients never mint a pickup code at all. A stop that reads
  //「is there still a pickup row」 rather than「is any door still open」
  // passes the pickup case and leaves a link list ticking for seven days.
  it.each([
    ['取件码', () => pickupShare(2)],
    ['链接', () => linkShare(2)],
  ])('%s 那一行到终点之后，interval 真的被清掉了', async (_kind, makeShare) => {
    // The stop is the justification for sampling every ten seconds: the
    // cost is only paid while something can still change. Untested, the
    // stop could be deleted and every wording assertion above would
    // stay green — a screen left in a background WeChat tab would go on
    // waking the phone every ten seconds forever.
    const installed = jest.spyOn(globalThis, 'setInterval');
    const cleared = jest.spyOn(globalThis, 'clearInterval');
    try {
      mockListShares.mockResolvedValue([makeShare()]);
      await render();

      // The share clock picked out by its cadence, not by being the
      // only timer: the screen owns several, and a bare
      // `getTimerCount()` difference would also be satisfied by one of
      // those going away while this one survived.
      const clock = installed.mock.calls
        .map((call, index) => ({ delay: call[1], id: installed.mock.results[index].value }))
        .filter((entry) => entry.delay === 10_000);
      expect(clock).toHaveLength(1);
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      expect(cleared).not.toHaveBeenCalledWith(clock[0].id);

      await act(async () => {
        jest.advanceTimersByTime(3 * 60_000);
      });

      // Still mounted, every row terminal — and the clock is gone. A
      // screen parked in a background WeChat tab must not go on waking
      // the phone every ten seconds to recompute a row that can no
      // longer change.
      expect(cleared).toHaveBeenCalledWith(clock[0].id);
      expect(
        installed.mock.calls.filter((call) => call[1] === 10_000),
        // …and it was not simply reinstalled by the render that followed.
      ).toHaveLength(1);
    } finally {
      installed.mockRestore();
      cleared.mockRestore();
    }
  });

  it('离开这一屏，钟跟着走 —— 不留一个跑七天的定时器', async () => {
    // The other way the interval outlives its reason. The stop inside
    // `tick` only fires once every row is terminal, and for a seven-day
    // link that is seven days away — so a patient who opens 隐私设置,
    // looks at the list and navigates back is the case the tick's stop
    // cannot reach. Without the effect returning its cleanup, that timer
    // keeps waking a phone parked in a WeChat tab for a week, on a
    // screen that is not even mounted.
    const installed = jest.spyOn(globalThis, 'setInterval');
    const cleared = jest.spyOn(globalThis, 'clearInterval');
    try {
      mockListShares.mockResolvedValue([dayLinkShare(7)]);
      const tree = await render();

      const clock = installed.mock.calls
        .map((call, index) => ({ delay: call[1], id: installed.mock.results[index].value }))
        .filter((entry) => entry.delay === 10_000);
      expect(clock).toHaveLength(1);
      expect(cleared).not.toHaveBeenCalledWith(clock[0].id);

      act(() => {
        tree.unmount();
      });
      mounted = null;

      expect(cleared).toHaveBeenCalledWith(clock[0].id);
      // …and nothing put a replacement in on the way out.
      expect(installed.mock.calls.filter((call) => call[1] === 10_000)).toHaveLength(1);
    } finally {
      installed.mockRestore();
      cleared.mockRestore();
    }
  });

  it('七天的链接，一小时里一次都不重画', async () => {
    // A link lives seven days and describeShareLife is day-granular
    // above 24 hours, so 360 samples in this hour all read「7 天后过期」.
    // Sampling is cheap; re-rendering a screen this size is not, and
    // this is the row kind that was brought into the interval's scope.
    mockListShares.mockResolvedValue([dayLinkShare(7)]);
    const tree = await render();
    expect(texts(tree).join(' ')).toContain('7 天后过期');
    const afterFirstPaint = mockHeaderRenders.count;

    // One tick per `act`, not one hour in one `act`. React batches every
    // state change inside a single act into one render, which would turn
    // 360 wasted renders into a delta of 1 and make this assertion look
    // like it was about something much smaller than it is. Advanced this
    // way the counter reads what a phone would actually do.
    for (let tick = 0; tick < 360; tick += 1) {
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
    }
    expect(mockHeaderRenders.count).toBe(afterFirstPaint);
    expect(texts(tree).join(' ')).toContain('7 天后过期');

    // …and it is a bail-out, not a stopped clock: the first sample that
    // reads a different day still lands. 25 hours in, `Math.ceil` over
    // the remaining milliseconds turns 7 into 6.
    await act(async () => {
      jest.advanceTimersByTime(24 * 60 * 60_000);
    });
    expect(mockHeaderRenders.count).toBeGreaterThan(afterFirstPaint);
    expect(texts(tree).join(' ')).toContain('6 天后过期');
  });
});

describe('撤销/作废是一个手指够得着的目标', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // Both kinds of row, because they are two different call sites' worth
  // of props on the same control and only one of them was ever measured.
  it.each([
    ['取件码', pickupShare(10)],
    ['链接', linkShare(30)],
  ])('%s 那一行的按钮，画出来的宽和高都不小于 MIN_TOUCH_TARGET', async (_kind, share) => {
    mockListShares.mockResolvedValue([share]);
    const tree = await render();
    const button = revokeButtons(tree)[0];
    expect(button).toBeDefined();
    // Measured off the real Button's composed style, not off a prop:
    // `compact` was the route that produced the 34pt height, but a
    // caller `style`, a minHeight on the `plain` tone, or the missing
    // minWidth that `plain` exposes all land in the same place — a
    // control under 48 on the web export, where the drawn box is the
    // whole hit box.
    const box = drawnBox(button);
    expect(box.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(box.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * 跌倒记录 — the four ways this screen could fail the person using it.
 *
 * 1. Costing more than one tap. The patient filling this in fell an
 *    hour ago and has one usable hand; if saving needs answers, the
 *    fall does not get recorded at all.
 * 2. Turning a blank into an answer. Every detail field is optional
 *    and NULL means 「没填」. A mis-tap that cannot be undone, or a
 *    「没受伤」 rendered for a row nobody answered, puts a fact into a
 *    medical record that the patient never stated.
 * 3. Leading with the number. A fall diary that opens with a running
 *    total is a progression alert. The entry action comes first.
 * 4. Printing a zero it did not read. 「还没有跌倒记录」 shown because
 *    the fetch failed is the app telling someone they have not fallen.
 */

jest.mock('../../../lib/api', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
}));

const mockListFalls = jest.fn();
const mockRecordFall = jest.fn();
const mockDeleteFall = jest.fn();
jest.mock('../../../lib/falls-api', () => ({
  __esModule: true,
  listFalls: (...args: unknown[]) => mockListFalls(...args),
  recordFall: (...args: unknown[]) => mockRecordFall(...args),
  deleteFall: (...args: unknown[]) => mockDeleteFall(...args),
}));

const mockConfirm = jest.fn();
jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ confirm: mockConfirm, notify: jest.fn() }),
}));

const mockEnsureConsent = jest.fn();
jest.mock('../../p-privacy_settings/components/SensitiveDataConsentGate', () => ({
  __esModule: true,
  default: () => null,
  useSensitiveDataConsentGate: () => ({
    ensureSensitiveDataConsent: mockEnsureConsent,
    gateProps: {},
  }),
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

// Kept pressable: every assertion below drives the real controls
// rather than reaching into state.
jest.mock('../../common/Button', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: ({ label, onPress }: { label: string; onPress: () => void }) =>
      ReactLocal.createElement(
        TouchableOpacity,
        { onPress, accessibilityRole: 'button', accessibilityLabel: label },
        ReactLocal.createElement(RNText, null, label),
      ),
  };
});

import FallsScreen from '../index';
import { FALLS_WINDOW_DAYS, toLocalIsoDate } from '../../../lib/falls';

const TODAY = toLocalIsoDate(new Date());

const emptyResult = {
  falls: [],
  summary: { total: 0, atCap: false, quarters: [], oldestDaysAgo: null },
  windowDays: FALLS_WINDOW_DAYS,
};

const savedFall = (overrides: Record<string, unknown> = {}) => ({
  id: 'f1',
  occurredOn: TODAY,
  daysAgo: 0,
  activity: null,
  location: null,
  handsFull: null,
  gotUpUnaided: null,
  injured: null,
  ...overrides,
});

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<FallsScreen />);
  });
  return tree;
};

/** Every string the screen renders, in tree order. */
const texts = (tree: TestRenderer.ReactTestRenderer): string[] =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string');

const press = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const target = tree.root.find((node: ReactTestInstance) =>
    typeof node.type !== 'string' || node.props.accessibilityRole === 'button'
      ? node.props.accessibilityLabel === label
      : false,
  );
  await act(async () => {
    target.props.onPress();
  });
};

/** An option chip — a radio, addressed by the words on it. */
const pressOption = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const option = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.accessibilityRole === 'radio' &&
      texts({ root: node } as TestRenderer.ReactTestRenderer).includes(label),
  );
  await act(async () => {
    option.props.onPress();
  });
};

beforeEach(() => {
  mockListFalls.mockReset().mockResolvedValue(emptyResult);
  mockRecordFall.mockReset().mockResolvedValue(savedFall());
  mockDeleteFall.mockReset().mockResolvedValue(undefined);
  mockConfirm.mockReset().mockResolvedValue(true);
  mockEnsureConsent.mockReset().mockResolvedValue(true);
});

describe('one tap has to be enough', () => {
  it('saves today with nothing else answered', async () => {
    const tree = await render();
    await press(tree, '保存这一次');

    expect(mockRecordFall).toHaveBeenCalledTimes(1);
    expect(mockRecordFall.mock.calls[0][0]).toMatchObject({
      occurredOn: TODAY,
      activity: null,
      location: null,
      handsFull: null,
      gotUpUnaided: null,
      injured: null,
    });
  });

  it('does not put the detail questions in the way', async () => {
    const tree = await render();
    // Collapsed on first render: the only thing between opening the
    // screen and saving is the date, which is already filled in.
    expect(texts(tree)).not.toContain('在哪里');
    expect(texts(tree)).toContain('补充当时的情况（可以不填）');
  });

  it('the save control comes before the count', async () => {
    mockListFalls.mockResolvedValue({
      ...emptyResult,
      falls: [savedFall({ id: 'f3', occurredOn: '2026-07-28' })],
      summary: {
        total: 3,
        atCap: false,
        quarters: [{ index: 0, startDaysAgo: 0, endDaysAgo: 89, count: 3 }],
        oldestDaysAgo: 40,
      },
    });
    const tree = await render();
    const rendered = texts(tree);
    const save = rendered.indexOf('保存这一次');
    const count = rendered.findIndex((text) => text.includes('记录到 3 次跌倒'));

    expect(save).toBeGreaterThanOrEqual(0);
    expect(count).toBeGreaterThanOrEqual(0);
    // A diary that greets someone with a running total is a
    // progression alert. Lead with the entry action; the count is
    // context, and it sits below the form.
    expect(save).toBeLessThan(count);
  });
});

describe('a blank is not an answer', () => {
  it('an option can be un-picked, and then it is not sent', async () => {
    const tree = await render();
    await press(tree, '补充当时的情况（可以不填）');
    await pressOption(tree, '受了伤');
    await pressOption(tree, '受了伤');
    await press(tree, '保存这一次');

    expect(mockRecordFall.mock.calls[0][0].injured).toBeNull();
  });

  it('「没受伤」 is a real answer and is sent as false', async () => {
    const tree = await render();
    await press(tree, '补充当时的情况（可以不填）');
    await pressOption(tree, '没受伤');
    await press(tree, '保存这一次');

    expect(mockRecordFall.mock.calls[0][0].injured).toBe(false);
  });

  it('a date-only entry says so rather than rendering negatives', async () => {
    mockListFalls.mockResolvedValue({
      ...emptyResult,
      falls: [savedFall({ id: 'f9', occurredOn: '2026-07-01' })],
      summary: { total: 1, atCap: false, quarters: [], oldestDaysAgo: 36 },
    });
    const tree = await render();
    const rendered = texts(tree);
    expect(rendered).toContain('这一条只有日期。');
    expect(rendered).not.toContain('没受伤');
    expect(rendered).not.toContain('双手是空的');
  });
});

describe('the future, and the consent that has to be asked first', () => {
  it('refuses a date the patient has not reached yet, without calling the API', async () => {
    const tree = await render();
    await pressOption(tree, '更早的一天');
    const input = tree.root.find(
      (node: ReactTestInstance) => node.props.accessibilityLabel === '跌倒的日期，格式为年-月-日',
    );
    await act(async () => {
      input.props.onChangeText('2099-01-01');
    });
    await press(tree, '保存这一次');

    expect(mockRecordFall).not.toHaveBeenCalled();
    expect(texts(tree).join(' ')).toContain('还没到');
  });

  it('writes nothing when the sensitive-data consent is declined', async () => {
    // PIPL Art. 29. The API refuses this route without a ledger row,
    // so a missed ask surfaces as a 403 — but the point is that the
    // patient sees a question, and that 「暂不同意」 means no write.
    mockEnsureConsent.mockResolvedValue(false);
    const tree = await render();
    await press(tree, '保存这一次');

    expect(mockRecordFall).not.toHaveBeenCalled();
    expect(texts(tree).join(' ')).toContain('这一次没有保存');
  });
});

describe('a fall answered 记不清 twice', () => {
  it('renders both answers, and not as two siblings sharing one key', async () => {
    // 「记不清」 is a real option on both 在哪里 and 跌倒发生在, and the
    // two labels are the same five characters. Keyed by their text,
    // these were two children with one key: React warns, and its
    // reconciler keeps one fiber per key — so the moment this list
    // reorders, one of the patient's two answers is a remount waiting
    // to happen.
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mockListFalls.mockResolvedValue({
        ...emptyResult,
        falls: [savedFall({ id: 'f5', location: 'unknown', activity: 'unknown' })],
        summary: { total: 1, atCap: false, quarters: [], oldestDaysAgo: 0 },
      });
      const tree = await render();

      expect(texts(tree).filter((text) => text === '记不清')).toHaveLength(2);
      const duplicateKey = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('same key'));
      expect(duplicateKey).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('a failed read never becomes a zero', () => {
  it('says it could not read, and does not claim there are no falls', async () => {
    mockListFalls.mockRejectedValue(new Error('读不到'));
    const tree = await render();
    const rendered = texts(tree).join(' ');

    expect(rendered).toContain('读不到');
    expect(rendered).not.toContain('还没有跌倒记录');
    expect(rendered).not.toMatch(/0 次/);
    // The form still works — the fall that just happened is the whole
    // reason the screen is open.
    expect(texts(tree)).toContain('保存这一次');
  });
});

describe('retracting an entry', () => {
  it('asks first, and says the timeline entry goes with it', async () => {
    mockListFalls.mockResolvedValue({
      ...emptyResult,
      falls: [savedFall({ id: 'f7', occurredOn: '2026-07-04' })],
      summary: { total: 1, atCap: false, quarters: [], oldestDaysAgo: 33 },
    });
    const tree = await render();
    await press(tree, '删除 2026-07-04 的跌倒记录');

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0][0].message).toContain('病程时间线');
    expect(mockDeleteFall).toHaveBeenCalledWith('f7');
  });

  it('says so when the retraction failed, beside the entry that is still there', async () => {
    mockDeleteFall.mockRejectedValue(new Error('服务器没接受这次删除'));
    mockListFalls.mockResolvedValue({
      ...emptyResult,
      falls: [savedFall({ id: 'f7', occurredOn: '2026-07-04' })],
      summary: { total: 1, atCap: false, quarters: [], oldestDaysAgo: 33 },
    });
    const tree = await render();
    await press(tree, '删除 2026-07-04 的跌倒记录');

    const rendered = texts(tree);
    // The row is still on screen, so silence would read as「删了但没消失」.
    expect(rendered).toContain('2026-07-04');
    expect(rendered.join(' ')).toContain('服务器没接受这次删除');
  });

  it('does not delete when the question is answered 取消', async () => {
    mockConfirm.mockResolvedValue(false);
    mockListFalls.mockResolvedValue({
      ...emptyResult,
      falls: [savedFall({ id: 'f7', occurredOn: '2026-07-04' })],
      summary: { total: 1, atCap: false, quarters: [], oldestDaysAgo: 33 },
    });
    const tree = await render();
    await press(tree, '删除 2026-07-04 的跌倒记录');

    expect(mockDeleteFall).not.toHaveBeenCalled();
  });
});

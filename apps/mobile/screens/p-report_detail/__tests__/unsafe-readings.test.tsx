/**
 * ══════════════════════════════════════════════════════════════════════
 * A REPORT WHOSE READINGS WERE WITHHELD IS NOT A REPORT WITH FEWER ROWS.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `withholdUnsafeReadings` (apps/api/src/modules/patient-profile/
 * profile.service.ts) asks two questions of every laboratory reading
 * before the payload leaves the server — is this number the same number
 * another row carries, and does it sit outside the interval this same
 * report printed beside it — and answers at the TOP LEVEL of the
 * payload: `unsafeReadings`, plus a one-line `unsafeReadingsNotice`. A
 * WITHHELD reading has had its cell deleted from `fields` under every
 * spelling it had. A FLAGGED one is still there and is explicitly not
 * to be printed as an ordinary number.
 *
 * That file's own note names the surfaces that owe the reader the other
 * half, and this screen is the first on the list. It read `fields` and
 * nothing else. So a report whose LDH was withheld for being a row
 * index rendered as a report that simply has one row fewer — no gap, no
 * mark, no sentence. A patient comparing this screen against the paper
 * in their hand finds a line on the paper and no line here, and the
 * only conclusion available is that this platform failed to read it.
 *
 * THE SCREEN IS RENDERED rather than a helper called, because the
 * defect was never in a helper: it was a payload member with no reader
 * anywhere on the page, and only a rendered tree shows it has one now.
 *
 * SYNTHETIC. 张三 is this repo's placeholder name; every payload below
 * was written for this file and no real report was read.
 */

import TestRenderer, { act } from 'react-test-renderer';

const mockGetOcr = jest.fn();

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    deletePatientDocument: jest.fn(),
    getPatientDocumentOcr: (...args: unknown[]) => mockGetOcr(...args),
    getMyConsent: jest.fn(async () => ({ level: 'none' })),
    generatePatientDocumentSummary: jest.fn(),
    patchPatientDocumentOcr: jest.fn(),
    reparsePatientDocument: jest.fn(),
    updateMyConsent: jest.fn(),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ documentId: 'doc-1' }),
}));

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn(async () => true) }),
}));

import ReportDetailScreen from '../index';

const mounted: TestRenderer.ReactTestRenderer[] = [];

const render = async (ocrPayload: Record<string, unknown>) => {
  mockGetOcr.mockResolvedValue({ documentId: 'doc-1', status: 'parsed', ocrPayload });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ReportDetailScreen />);
  });
  mounted.push(tree);
  return tree;
};

/** Every string the patient can read, flattened. */
const readable = (tree: TestRenderer.ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    walk((node as { children?: unknown }).children ?? []);
  };
  walk(tree.toJSON());
  return out.join(' | ');
};

/** 来源追溯 is collapsed by default. */
const expand = async (tree: TestRenderer.ReactTestRenderer) => {
  const toggle = tree.root
    .findAll((node) => typeof node.props?.onPress === 'function' && !!node.props?.label)
    .find((node) => node.props.label === '展开核对清单');
  if (!toggle) throw new Error('no 展开核对清单 control on the screen');
  await act(async () => {
    toggle.props.onPress();
  });
};

afterEach(async () => {
  for (const tree of mounted.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
  jest.clearAllMocks();
});

/** A payload as the guard leaves it: the LDH cell is GONE from
 *  `fields`, and the record of it is at the top level. */
const WITHHELD_PAYLOAD = {
  fields: {
    fieldCount: '2',
    patientName: '张三',
    ck: '693',
    ckFlag: 'high',
    ckReference: '50-310',
  },
  unsafeReadings: [
    {
      analyte: 'ldh',
      keys: ['ldh', 'table_ldh'],
      disposition: 'withheld',
      reason: 'duplicate_reading',
      sharedWith: ['uric_acid'],
      corroboration: 'page_prints_it_once',
    },
  ],
  unsafeReadingsNotice:
    '这份报告里有数值没有通过核对：与同一份报告上另一个项目重复、而报告原件核对不上的数值已经不再显示。请以报告原件为准，必要时重新识别一次。',
};

describe('数值核对：一份被拿掉了数值的报告要说出来', () => {
  it('印出服务端那句话，而不是让屏幕上少一行了事', async () => {
    const text = readable(await render(WITHHELD_PAYLOAD));
    expect(text).toContain('数值核对');
    expect(text).toContain('这份报告里有数值没有通过核对');
    expect(text).toContain('请以报告原件为准');
  });

  it('说出是哪一项被拿掉了，用这块屏幕自己的中文名', async () => {
    const text = readable(await render(WITHHELD_PAYLOAD));
    expect(text).toContain('这些数值本平台已不再显示');
    expect(text).toContain('乳酸脱氢酶 LDH');
    expect(text).toContain('和这份报告上的另一个项目印着同一个数，报告原件核对不上');
    // The two asides that make the judgement checkable against paper.
    expect(text).toContain('与尿酸是同一个数');
    expect(text).toContain('依据：报告原文里这个数只出现过一次');
  });

  /**
   * THE NUMBER IS NOT IN `unsafeReadings` AND MUST NOT COME BACK.
   * Handing the withheld value over under a second key would make the
   * deletion theatre — this is the one thing the record deliberately
   * does not carry, so the screen has nothing to print and must print
   * nothing.
   */
  it('绝不把被拿掉的那个数再印回屏幕上', async () => {
    const text = readable(
      await render({
        ...WITHHELD_PAYLOAD,
        unsafeReadings: [
          {
            ...WITHHELD_PAYLOAD.unsafeReadings[0],
            // A payload that (wrongly) carried the value anyway: this
            // screen must still have no way to reach it.
            value: '9',
          },
        ],
      }),
    );
    expect(text).toContain('乳酸脱氢酶 LDH');
    expect(text).not.toContain('| 9 |');
  });

  it('没有 unsafeReadings 的报告完全和以前一样 —— 不多出一块空面板', async () => {
    const text = readable(await render({ fields: { fieldCount: '1', ck: '693' } }));
    expect(text).not.toContain('数值核对');
  });
});

describe('被标注但仍在显示的数值，屏幕上要看得见那个标注', () => {
  const FLAGGED_PAYLOAD = {
    fields: {
      fieldCount: '2',
      ck: '693',
      ckReference: '50-310',
      ldh: '319',
      ldhFlag: 'high',
      ldhReference: '120-250',
    },
    unsafeReadings: [
      {
        analyte: 'ck',
        keys: ['ck'],
        disposition: 'flagged',
        reason: 'outside_reference_interval',
      },
    ],
    unsafeReadingsNotice:
      '这份报告里有数值需要你留意：超出报告自己印的参考区间的数值已标注。这些数值仍按报告原样显示，请以报告原件为准。',
  };

  it('标题说清楚这些值还在屏幕上，而不是又一份被拿掉的清单', async () => {
    const text = readable(await render(FLAGGED_PAYLOAD));
    expect(text).toContain('这些数值仍按报告原样显示，请对着报告原件留意');
    expect(text).toContain('肌酸激酶 CK');
    expect(text).toContain('超出报告自己印的参考区间');
    expect(text).not.toContain('这些数值本平台已不再显示');
  });

  /** 来源追溯 is the complete cell list, so the mark belongs on the
   *  cell — a defence that marks where nothing shows the mark is a
   *  defence that does nothing. */
  it('来源追溯 里那一格本身带上标注，而且和数值分开两行', async () => {
    const tree = await render(FLAGGED_PAYLOAD);
    await expand(tree);
    const text = readable(tree);
    expect(text).toContain('本平台标注：超出报告自己印的参考区间');
    // The value is still the report's own, unedited.
    expect(text).toContain('693');
    // And the row the guard said nothing about carries no mark.
    expect(text.split('本平台标注').length - 1).toBe(1);
  });
});

/**
 * A reason or a corroboration token this build has no wording for is
 * still a reading the reader must be told about. Dropping the row would
 * hide precisely what this panel exists for.
 */
describe('读不懂的原因也要照说，只是说得笼统一点', () => {
  it('用兜底句子，而不是把这一行丢掉', async () => {
    const text = readable(
      await render({
        fields: { fieldCount: '1', ck: '693' },
        unsafeReadings: [
          {
            analyte: 'ldh',
            keys: ['ldh'],
            disposition: 'withheld',
            reason: 'some_future_reason',
            corroboration: 'some_future_token',
          },
        ],
        unsafeReadingsNotice: '这份报告里有数值没有通过核对。',
      }),
    );
    expect(text).toContain('乳酸脱氢酶 LDH');
    expect(text).toContain('这一项没有通过本平台的核对');
    expect(text).not.toContain('some_future_reason');
    expect(text).not.toContain('some_future_token');
  });
});

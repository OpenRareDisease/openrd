/**
 * NO WIRE ENUM REACHES THE PATIENT ON THIS SCREEN.
 *
 * Every value on 报告详情 is Chinese except the ones nobody translated
 * back. 性别 was one: the report the patient uploaded said 「男」, this
 * platform's own parser matched that word and stored `male`
 * (`_parse_patient_info` in fshd_report_service.py), and the screen
 * printed `male` under a Chinese label — a round trip out of the
 * language and back that kept the meaning and lost the wording, on a
 * row sitting directly beneath 患者姓名.
 *
 * The screen is RENDERED here rather than the formatter called,
 * because the defect was never in a formatter — it was in a row that
 * had no formatter at all, and only a rendered tree can show that the
 * row now goes through one.
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

const render = async (fields: Record<string, string>) => {
  mockGetOcr.mockResolvedValue({
    documentId: 'doc-1',
    status: 'parsed',
    ocrPayload: { fields: { fieldCount: String(Object.keys(fields).length), ...fields } },
  });
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

afterEach(async () => {
  for (const tree of mounted.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
  jest.clearAllMocks();
});

describe('性别 is shown in the language of the rest of the screen', () => {
  // SYNTHETIC fixture. 张三 is the placeholder name this repo's own
  // fixtures use; no real patient's report was read to write this.
  it('renders 男 for the stored `male`, and never the enum', async () => {
    const tree = await render({ patientName: '张三', patientSex: 'male' });
    const text = readable(tree);

    expect(text).toContain('性别');
    expect(text).toContain('男');
    expect(text).not.toContain('male');
  });

  it('renders 女 for the stored `female`', async () => {
    const tree = await render({ patientName: '张三', patientSex: 'female' });
    const text = readable(tree);

    expect(text).toContain('女');
    expect(text).not.toContain('female');
  });

  /**
   * The parser's last branch is `else raw_sex` — anything it does not
   * recognise is passed through as the report's own text. So this row
   * must pass it through too: a value that is already the report's word
   * is right, and mapping the unrecognised case onto 男 or 女 would put
   * a sex on screen that nobody read off the page.
   */
  it('passes an unrecognised value through as the report wrote it', async () => {
    const tree = await render({ patientName: '张三', patientSex: '未说明' });

    expect(readable(tree)).toContain('未说明');
  });
});

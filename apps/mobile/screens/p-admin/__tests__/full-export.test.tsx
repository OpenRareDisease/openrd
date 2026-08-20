import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * 全量导出 — §B4「全量导出是最危险的一个动作……必须有二次确认」.
 *
 * WHAT THIS FILE PINS IS THAT THE CONFIRMATION IS A GATE.
 *
 * A second confirmation that a tired operator can clear by tapping OK
 * is not a second confirmation, so the assertions below are about the
 * refusals: nothing is requested before the phrase is typed, a phrase
 * that is one character off does not enable the button, and the box is
 * empty again afterwards so a screen left open cannot be replayed.
 *
 * It also pins the platform check happening BEFORE the request. The
 * server writes an `admin.export` audit row and reads every profile in
 * the database on the way to sending those bytes; discovering only
 * afterwards that this client cannot save a file leaves a trail saying
 * somebody exported the cohort when nobody received it.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
  multiRemove: () => Promise.resolve(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
  isAvailableAsync: () => Promise.resolve(false),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
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
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader') };
});

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockRequest = jest.fn();

jest.mock('../../../lib/admin-api', () => {
  const actual = jest.requireActual('../../../lib/admin-api');
  return { ...actual, requestAdminFullPatientCsv: (...args: unknown[]) => mockRequest(...args) };
});

const mockSave = jest.fn();
const mockSupported = jest.fn(() => true);

jest.mock('../download', () => {
  const actual = jest.requireActual('../download');
  return {
    ...actual,
    isDownloadSupported: () => mockSupported(),
    saveBlobInBrowser: (...args: unknown[]) => mockSave(...args),
  };
});

import { ADMIN_AUDIT_NOTICE_FULL_EXPORT } from '../common';
import AdminFullExportScreen from '../full-export';

const PHRASE = '确认导出全部 35 位患者的完整数据 2026-08-13';

const textContent = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => textContent(child as ReactTestInstance)).join('');
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AdminFullExportScreen />);
    await flush();
  });
  return tree;
};

const findByLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.find(
    (candidate) =>
      candidate.props?.accessibilityLabel === label &&
      typeof candidate.props?.onPress === 'function',
  );

const press = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const node = findByLabel(tree, label);
  await act(async () => {
    node.props.onPress();
    await flush();
  });
};

const type = async (tree: TestRenderer.ReactTestRenderer, text: string) => {
  const input = tree.root.find(
    (candidate) => candidate.props?.accessibilityLabel === '全量导出确认口令',
  );
  await act(async () => {
    input.props.onChangeText(text);
    await flush();
  });
};

const confirmationRequired = {
  state: 'confirmation_required' as const,
  requiredConfirmation: PHRASE,
  patientCount: 35,
  notes: ['这份文件包含全部患者的姓名、手机号、所在地区与全部基线临床字段，请只在需要时导出。'],
};

const downloaded = {
  state: 'downloaded' as const,
  download: {
    blob: { size: 4096 } as unknown as Blob,
    fileName: 'openrd-patients-20260813T041107Z-by-a1.csv',
  },
};

beforeEach(() => {
  mockRequest.mockReset();
  mockSave.mockReset();
  mockSupported.mockReset().mockReturnValue(true);
});

describe('nothing happens until a human asks for it', () => {
  it('requests nothing on mount', async () => {
    await render();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('asks for the size with no confirmation attached', async () => {
    mockRequest.mockResolvedValue(confirmationRequired);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    expect(mockRequest).toHaveBeenCalledWith(undefined);
    const screen = textContent(tree.root);
    expect(screen).toContain('35 位患者');
    expect(screen).toContain(PHRASE);
    // The server's own caveats, verbatim. A paraphrase here drifts
    // milder than the file.
    expect(screen).toContain('这份文件包含全部患者的姓名、手机号');
  });
});

describe('the phrase has to be typed, exactly', () => {
  it('leaves the export button disabled while the box is empty', async () => {
    mockRequest.mockResolvedValue(confirmationRequired);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    expect(findByLabel(tree, '确认导出全部患者').props.disabled).toBe(true);
  });

  it('leaves it disabled for a phrase that is one character off, and says so', async () => {
    mockRequest.mockResolvedValue(confirmationRequired);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    // 34 instead of 35: the count is IN the phrase precisely so that a
    // remembered one from yesterday does not work.
    await type(tree, '确认导出全部 34 位患者的完整数据 2026-08-13');
    expect(findByLabel(tree, '确认导出全部患者').props.disabled).toBe(true);
    expect(textContent(tree.root)).toContain('还对不上');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('sends the phrase back and saves the file under the server name', async () => {
    mockRequest.mockResolvedValueOnce(confirmationRequired).mockResolvedValueOnce(downloaded);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    await type(tree, PHRASE);
    await press(tree, '确认导出全部患者');

    expect(mockRequest).toHaveBeenLastCalledWith(PHRASE);
    expect(mockSave).toHaveBeenCalledWith(
      downloaded.download.blob,
      'openrd-patients-20260813T041107Z-by-a1.csv',
    );
    expect(textContent(tree.root)).toContain('已下载 openrd-patients-20260813T041107Z-by-a1.csv');
  });

  it('does not leave a typed phrase in the box for the next person', async () => {
    mockRequest.mockResolvedValueOnce(confirmationRequired).mockResolvedValueOnce(downloaded);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    await type(tree, PHRASE);
    await press(tree, '确认导出全部患者');
    await press(tree, '再导一次');
    mockRequest.mockResolvedValue(confirmationRequired);
    await press(tree, '查看规模并取确认口令');
    expect(findByLabel(tree, '确认导出全部患者').props.disabled).toBe(true);
  });
});

describe('a stale phrase is a new confirmation, not a failure', () => {
  it('shows the new phrase and says the old one lapsed', async () => {
    mockRequest.mockResolvedValueOnce(confirmationRequired).mockResolvedValueOnce({
      state: 'confirmation_required',
      requiredConfirmation: '确认导出全部 36 位患者的完整数据 2026-08-14',
      patientCount: 36,
      notes: [],
    });
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    await type(tree, PHRASE);
    await press(tree, '确认导出全部患者');

    const screen = textContent(tree.root);
    expect(screen).toContain('你上一次确认已经失效了');
    expect(screen).toContain('确认导出全部 36 位患者的完整数据 2026-08-14');
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('the phrase cannot be pasted in one gesture', () => {
  it('renders the phrase with selectable={false}', async () => {
    // §B4's 二次确认 rests on this on the web export, which is the only
    // platform §C ships. react-native-web attaches `user-select: none`
    // only for `selectable={false}` (dist/exports/Text/index.js:115,
    // 183-188); with the prop absent the browser default lets the
    // phrase be long-pressed, selected and pasted, and the typing gate
    // becomes a copy button with extra steps.
    mockRequest.mockResolvedValueOnce(confirmationRequired);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');

    const phrase = tree.root.find(
      (node) => node.props?.selectable !== undefined && textContent(node) === PHRASE,
    );
    expect(phrase.props.selectable).toBe(false);
  });
});

describe('the file name is the server’s, or the screen says it is not', () => {
  it('names the fallback as a fallback instead of passing it off as the real one', async () => {
    mockRequest.mockResolvedValueOnce(confirmationRequired).mockResolvedValueOnce({
      state: 'downloaded',
      download: { blob: { size: 4096 } as unknown as Blob, fileName: null },
    });
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    await type(tree, PHRASE);
    await press(tree, '确认导出全部患者');

    const screen = textContent(tree.root);
    expect(screen).toContain('服务端文件名未收到');
    expect(screen).toContain('浏览器没有把服务端给的文件名交给页面');
    // §B4 wants the operator in the filename. This one cannot carry it,
    // and the screen says where the real name is instead. THIS export
    // is the only one that can say so: `recordFullExportAudit` is the
    // only writer that puts `fileName` in an audit payload.
    expect(screen).toContain('admin.export 审计记录里（payload 的 fileName）');
  });
});

describe('a client that cannot save a file does not spend an export getting there', () => {
  it('requests nothing at all', async () => {
    mockSupported.mockReturnValue(false);
    const tree = await render();
    expect(textContent(tree.root)).toContain('这个客户端不能保存文件');
    expect(findByLabel(tree, '查看规模并取确认口令').props.disabled).toBe(true);
    await act(async () => {
      findByLabel(tree, '查看规模并取确认口令').props.onPress();
      await flush();
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('a real failure is reported as one', () => {
  it('renders the 409 wording and offers the safe step again', async () => {
    const { ApiError } = jest.requireActual('../../../lib/api');
    const conflict = new ApiError(
      '患者数量在你确认之后发生了变化（确认时 35 位，现在 36 位），请重新确认。',
    );
    conflict.status = 409;
    mockRequest.mockResolvedValueOnce(confirmationRequired).mockRejectedValueOnce(conflict);
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    await type(tree, PHRASE);
    await press(tree, '确认导出全部患者');

    const screen = textContent(tree.root);
    // The server's own sentence, with nothing appended: three of this
    // router's four 409s are not fixed by retrying. See errors.test.ts.
    expect(screen).toContain(
      '患者数量在你确认之后发生了变化（确认时 35 位，现在 36 位），请重新确认。',
    );
    expect(screen).not.toContain('重新来一遍');
    expect(mockSave).not.toHaveBeenCalled();

    // 重试 re-asks for the phrase; it never re-sends a confirmed export.
    mockRequest.mockResolvedValue(confirmationRequired);
    await press(tree, '重试');
    expect(mockRequest).toHaveBeenLastCalledWith(undefined);
  });
});

describe('the audit banner is true on the page that takes every patient', () => {
  it('draws the notice written for this screen, which promises no patient, next to the two-row note', async () => {
    // The page where the old wording was worst: the file is every
    // patient in the database, and the promise it carried was that the
    // trail would say WHICH patient. `exportAllPatientsCsv` is mounted
    // without a `targetParam` and `recordFullExportAudit` writes
    // `targetUserId: null` with a count — how many, not who. The
    // block note is the one that says what the second row holds, and
    // the two sentences have to agree.
    const screen = textContent((await render()).root);
    expect(screen).toContain(ADMIN_AUDIT_NOTICE_FULL_EXPORT);
    expect(screen).not.toContain('看了哪位患者');
    expect(screen).toContain('一条记下导了多少人和文件名');
  });

  it('does not say anything was recorded on a screen that requested nothing', async () => {
    // THE STATE THE SCREEN OPENS IN. Every other back-office screen
    // fetches on mount; this one deliberately does not — 「requests
    // nothing on mount」 at the top of this file is the same fact
    // asserted from the other side. A banner opening with 「你在这里打开
    // 的每一页都会记进审计」 therefore told an operator, in the loudest
    // sentence on the page, that a row existed for a page that had not
    // touched the server.
    const tree = await render();
    expect(mockRequest).not.toHaveBeenCalled();
    const screen = textContent(tree.root);
    expect(screen).toContain('这一页打开时不向服务端要任何东西，所以到这里为止没有记下什么');
    expect(screen).not.toContain('你在这里打开的每一页都会记进审计');
  });
});

/**
 * THE FILE THIS SCREEN DESCRIBES IS MISSING VALUES, AND IT MUST NOT SAY
 * WHICH DOCUMENT THEY WOULD HAVE COME FROM.
 *
 * The autofill reads whichever document `pickGeneticEvidenceDocument`
 * picks as a profile's genetic evidence, and that picker takes a 病历
 * 摘要 quoting the results when the genetics report read out nothing.
 * This screen sees neither the profile nor the document — it renders a
 * confirmation phrase and the server's notes — so naming a 基因报告 was
 * asserting a document it has no way to have seen, about every patient
 * at once.
 */
describe('后台不替某一类文件背书', () => {
  it('says the autofilled fields come from an uploaded file, in its own note and in the server note', async () => {
    mockRequest.mockResolvedValue({
      ...confirmationRequired,
      notes: [
        '基线字段是数据库中存储的值，不含「从上传的文件自动补全」的部分——界面上看得到的 D4Z4 结果，这份文件里可能是空的。',
      ],
    });
    const tree = await render();
    await press(tree, '查看规模并取确认口令');
    const screen = textContent(tree.root);

    expect(screen).toContain('其实是从已上传的文件里读出来的那些字段');
    expect(screen).not.toContain('基因报告');
    // The caveat the sentence exists for is untouched: those columns
    // can be empty in the file while the app shows a value.
    expect(screen).toContain('在这个文件里可能是空的');
  });
});

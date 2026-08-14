import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * §B3, at the surface a person actually reads.
 *
 * lib/__tests__/admin-api.test.ts pins the reader: an entry it cannot
 * parse becomes `unreadable`. This file pins what the SCREEN does with
 * that — because a correct union rendered as 「本人填写」 is the same
 * defect with a better data model, and 「导出里区分了但界面里抹平」 is
 * exactly what §B3 forbids in the other direction.
 *
 * It also pins the save: the PUT must carry the WHOLE baseline. A
 * partial one reads as the administrator clearing every field it left
 * out, and that is not visible from the outside afterwards.
 */

// lib/admin-api imports lib/api, which reaches AsyncStorage and
// SecureStore through lib/session-storage. Neither has a native module
// under jest; the same two stubs appear in every screen test that
// touches the API module.
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

const mockConfirm = jest.fn();
const mockNotify = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
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
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader') };
});

jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ confirm: mockConfirm, notify: mockNotify }),
}));

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockGetRecord = jest.fn();
const mockUpdateBaseline = jest.fn();
const mockExport = jest.fn();

jest.mock('../../../lib/admin-api', () => {
  const actual = jest.requireActual('../../../lib/admin-api');
  return {
    ...actual,
    getAdminPatientRecord: (...args: unknown[]) => mockGetRecord(...args),
    updateAdminPatientBaseline: (...args: unknown[]) => mockUpdateBaseline(...args),
    exportAdminPatient: (...args: unknown[]) => mockExport(...args),
  };
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

import AdminPatientRecordScreen from '../patient-record';

const USER_ID = '11111111-1111-4111-8111-111111111111';

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

/** What the record endpoint is expected to answer with, in the shape
 *  lib/admin-api.ts states. */
const recordBody = (overrides: Record<string, unknown> = {}) => ({
  account: {
    userId: USER_ID,
    phoneNumber: '13900000001',
    email: null,
    role: 'patient',
    isActive: true,
    createdAt: '2026-07-01T02:00:00.000Z',
  },
  identity: {
    fullName: '张三',
    preferredName: null,
    patientCode: 'FSHD-0001',
    regionLabel: null,
    updatedAt: '2026-08-01T02:00:00.000Z',
  },
  baseline: {
    foundation: { fullName: '张三', birthYear: 1988 },
    diseaseBackground: { d4z4: '4/22' },
  },
  baselineIsStored: true,
  fieldOrigins: [],
  documents: [],
  followups: [],
  falls: [],
  instruments: [],
  ...overrides,
});

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AdminPatientRecordScreen />);
    await flush();
  });
  return tree;
};

const pressByLabel = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root.find(
    (candidate) =>
      candidate.props?.accessibilityLabel === label &&
      typeof candidate.props?.onPress === 'function',
  );
  await act(async () => {
    node.props.onPress();
    await flush();
  });
};

const typeInto = async (tree: TestRenderer.ReactTestRenderer, labelStart: string, text: string) => {
  const input = tree.root.find(
    (candidate) =>
      typeof candidate.props?.accessibilityLabel === 'string' &&
      candidate.props.accessibilityLabel.startsWith(labelStart) &&
      typeof candidate.props?.onChangeText === 'function',
  );
  await act(async () => {
    input.props.onChangeText(text);
    await flush();
  });
};

beforeEach(() => {
  mockParams = { userId: USER_ID };
  mockConfirm.mockReset().mockResolvedValue(true);
  mockNotify.mockReset();
  mockGetRecord.mockReset().mockResolvedValue(undefined);
  mockUpdateBaseline.mockReset().mockResolvedValue(undefined);
  mockExport.mockReset().mockResolvedValue(undefined);
  mockSave.mockReset();
  mockSupported.mockReset().mockReturnValue(true);
});

describe('provenance is rendered, not flattened', () => {
  it('shows 管理员代填 with who and when', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(
      actual.readAdminPatientRecord(
        recordBody({
          fieldOrigins: [
            {
              path: 'diseaseBackground.d4z4',
              origin: {
                state: 'admin_entered',
                adminUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                at: '2026-08-13T04:11:07.912Z',
              },
            },
          ],
        }),
      ),
    );
    const tree = await render();
    const screen = textContent(tree.root);
    expect(screen).toContain('管理员代填');
    expect(screen).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('shows an unreadable entry as 来源不明, never as 本人填写', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(
      actual.readAdminPatientRecord(
        recordBody({
          // Exactly what a hand-written UPDATE or a half-applied future
          // shape leaves behind. The tempting fallback is 「no entry」,
          // which renders as the patient's own.
          fieldOrigins: [{ path: 'foundation.fullName', origin: { state: 'imported' } }],
        }),
      ),
    );
    const tree = await render();
    const fieldRow = tree.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string')
      .map((node) => String(node.props.accessibilityLabel))
      .find((label) => label.startsWith('姓名'));
    expect(fieldRow).toBe('姓名（来源不明）');
    expect(textContent(tree.root)).toContain('它不等于「本人填写」');
  });

  it('chips 来源不明 on every field when the server sent no fieldOrigins at all', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    const body = recordBody() as Record<string, unknown>;
    // A back-office bundle talking to a build that does not send the
    // section — the same skew lib/clinical-passport-pdf.ts handles for
    // the patient's own passport. An absent LIST is not an empty one:
    // 「no entry for this path」 means the patient typed it only when
    // the list itself arrived.
    delete body.fieldOrigins;
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(body));
    const tree = await render();
    const labels = tree.root
      .findAll((node) => typeof node.props?.accessibilityLabel === 'string')
      .map((node) => String(node.props.accessibilityLabel));
    expect(labels).toContain('姓名（来源不明）');
    expect(labels.some((label) => label.includes('（本人填写）'))).toBe(false);
    expect(textContent(tree.root)).toContain('服务端这一版没有返回字段来源');
  });
});

describe('saving', () => {
  it('sends the whole baseline, not just the edited field', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    await typeInto(tree, 'D4Z4 重复数', '3/22');
    await pressByLabel(tree, '保存 1 处改动');

    expect(mockConfirm).toHaveBeenCalled();
    // The third argument is the version these boxes were filled from.
    // It becomes If-Match, and it is what lets the server refuse a
    // whole-baseline payload built before the patient's own edit.
    expect(mockUpdateBaseline).toHaveBeenCalledWith(
      USER_ID,
      {
        foundation: { fullName: '张三', birthYear: 1988 },
        diseaseBackground: { d4z4: '3/22' },
      },
      '2026-08-01T02:00:00.000Z',
    );
    // Re-read after the write: the markers on screen have to be the
    // server's, not this screen's guess about what it did.
    expect(mockGetRecord).toHaveBeenCalledTimes(2);
  });

  it('refuses a year outside 1900..今年 instead of storing it', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    await typeInto(tree, '出生年份', '19999');
    await pressByLabel(tree, '保存 1 处改动');

    expect(mockUpdateBaseline).not.toHaveBeenCalled();
    expect(textContent(tree.root)).toContain('出生年份');
  });

  it('says in the confirm dialog that clearing leaves no marker', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    // 姓名 is 张三 in the fixture; emptying the box is an erase.
    await typeInto(tree, '姓名', '');
    await pressByLabel(tree, '保存 1 处改动');

    const message = String(mockConfirm.mock.calls.at(-1)?.[0]?.message ?? '');
    expect(message).toContain('清空不会留下「管理员代填」标记');
    expect(message).not.toContain('姓名 会带上一个「管理员代填」标记');
  });

  it('still promises the marker for a field it is actually filling in', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    await typeInto(tree, 'D4Z4 重复数', '3/22');
    await pressByLabel(tree, '保存 1 处改动');

    const message = String(mockConfirm.mock.calls.at(-1)?.[0]?.message ?? '');
    expect(message).toContain('「管理员代填」标记');
    expect(message).not.toContain('清空');
  });

  it('does not offer the form at all when the server will not say the baseline is the stored column', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(
      actual.readAdminPatientRecord(recordBody({ baselineIsStored: false })),
    );
    const tree = await render();

    const hasSave = tree.root.findAll(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('保存'),
    );
    expect(hasSave).toHaveLength(0);
    expect(textContent(tree.root)).toContain('基因报告自动补全');
  });
});

describe('missing sections', () => {
  it('tells the operator a section was not returned rather than showing it as empty', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    const body = recordBody();
    delete (body as Record<string, unknown>).falls;
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(body));
    const tree = await render();
    const screen = textContent(tree.root);
    expect(screen).toContain('服务端没有返回这一项');
    // The sections that WERE returned empty keep their own sentence.
    expect(screen).toContain('没有报告');
  });
});

describe('an account that never opened the baseline form', () => {
  /** What `AdminController.getPatientRecord` sends when
   *  `getStoredProfile` finds no row: identity null, baseline null, and
   *  `baselineIsStored: true` — which is correct (a null baseline IS
   *  the stored column) and is exactly why `baselineIsStored` alone is
   *  not enough to open the form. */
  const noProfile = () =>
    jest
      .requireActual('../../../lib/admin-api')
      .readAdminPatientRecord(recordBody({ identity: null, baseline: null }));

  it('does not open an edit form that cannot be saved', async () => {
    mockGetRecord.mockResolvedValue(noProfile());
    const tree = await render();

    const saveButtons = tree.root.findAll(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('保存'),
    );
    expect(saveButtons).toHaveLength(0);
    const boxes = tree.root.findAll((node) => typeof node.props?.onChangeText === 'function');
    expect(boxes).toHaveLength(0);
  });

  it('says why, instead of leaving the server to explain it wrongly', async () => {
    // `AdminController.updatePatientBaseline` now answers this account
    // with its own 409 before `upsertBaseline` is reached — 「这个账号注册
    // 后还没有建过健康档案，后台不能替他建」, thrown from that method's
    // `if (!stored)` branch in admin.controller.ts. The gate
    // here is what keeps the operator from meeting it at all. Reaching
    // `ensureProfileForUser`'s 404「Patient profile not found」 from this
    // screen now means the profile row disappeared mid-edit, and
    // `describeAdminError` still renders that as 「这个账号可能已经注销」 —
    // which is why the form must not open on an account that never had
    // one.
    mockGetRecord.mockResolvedValue(noProfile());
    const screen = textContent((await render()).root);
    expect(screen).toContain('这个账号还没有健康档案');
    expect(screen).toContain('后台也建不了这一行');
    expect(screen).not.toContain('这个账号可能已经注销');
  });

  it('does not offer an export the server would refuse', async () => {
    mockGetRecord.mockResolvedValue(noProfile());
    const tree = await render();
    const exportButtons = tree.root.findAll(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('导出 '),
    );
    expect(exportButtons).toHaveLength(0);
    expect(textContent(tree.root)).toContain('没有可导出的内容');
  });
});

describe('the save path reports the server\u2019s refusal, not a rewritten one', () => {
  it('renders a 409 verbatim instead of telling the operator to try again', async () => {
    // The account HAS a profile row when the screen loads and loses it
    // (or the request races an account deletion) by the time the PUT
    // lands. Whatever the reason, this 409 is not fixed by retrying, and
    // the screen used to append 「重新来一遍即可」 to every one of them.
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const { ApiError } = jest.requireActual('../../../lib/api');
    const conflict = new ApiError(
      '这个账号注册后还没有建过健康档案，后台不能替他建。请让患者本人在 App 里先保存一次基线，或者确认这个用户 ID 是不是拿错了。',
    );
    conflict.status = 409;
    mockUpdateBaseline.mockRejectedValue(conflict);

    const tree = await render();
    await typeInto(tree, 'D4Z4 重复数', '3/22');
    await pressByLabel(tree, '保存 1 处改动');

    const screen = textContent(tree.root);
    expect(screen).toContain('请让患者本人在 App 里先保存一次基线');
    expect(screen).not.toContain('重新来一遍');
    expect(screen).not.toContain('数据在你操作期间变了');
  });
});

describe('a value longer than the column takes', () => {
  it('names the field instead of sending a PUT that comes back Validation failed', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    // 41 characters against `nullableText(40)` on
    // diseaseBackground.diagnosisType. Reachable in practice because a
    // value stored before that cap arrived is shown in full, and the
    // box's own maxLength does not shorten what is already there.
    mockGetRecord.mockResolvedValue(
      actual.readAdminPatientRecord(
        recordBody({
          baseline: {
            foundation: { fullName: '张三' },
            diseaseBackground: { diagnosisType: 'F'.repeat(41) },
          },
        }),
      ),
    );
    const tree = await render();
    await typeInto(tree, 'FSHD 分型', `${'F'.repeat(40)}X`);
    await pressByLabel(tree, '保存 1 处改动');

    expect(mockUpdateBaseline).not.toHaveBeenCalled();
    const screen = textContent(tree.root);
    expect(screen).toContain('「FSHD 分型」最多 40 个字，现在是 41 个');
  });

  it('caps the box at the number the server accepts', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();
    const box = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('FSHD 分型') &&
        typeof node.props?.onChangeText === 'function',
    );
    expect(box.props.maxLength).toBe(40);
  });
});

describe('§B4 导出：单个患者', () => {
  const ready = () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
  };

  it('asks for the format the operator pressed and saves the server-named file', async () => {
    ready();
    mockExport.mockResolvedValue({
      blob: { size: 2048 } as unknown as Blob,
      fileName: 'openrd-treat-nmd-x-20260813T041107Z-by-a1.json',
    });
    const tree = await render();
    await pressByLabel(tree, '导出 TREAT-NMD');

    expect(mockExport).toHaveBeenCalledWith(USER_ID, 'treat-nmd');
    expect(mockSave).toHaveBeenCalledWith(
      expect.anything(),
      'openrd-treat-nmd-x-20260813T041107Z-by-a1.json',
    );
    expect(textContent(tree.root)).toContain(
      '已下载 openrd-treat-nmd-x-20260813T041107Z-by-a1.json',
    );
  });

  it('spends no audit row on a client that cannot save the file', async () => {
    ready();
    mockSupported.mockReturnValue(false);
    const tree = await render();
    await pressByLabel(tree, '导出 FHIR R4');
    expect(mockExport).not.toHaveBeenCalled();
    expect(textContent(tree.root)).toContain('这个客户端不能保存文件');
  });

  it('reports a failure rather than looking like it downloaded something', async () => {
    ready();
    const { ApiError } = jest.requireActual('../../../lib/api');
    const missing = new ApiError('Patient profile not found');
    missing.status = 404;
    mockExport.mockRejectedValue(missing);
    const tree = await render();
    await pressByLabel(tree, '导出 Phenopacket');
    expect(mockSave).not.toHaveBeenCalled();
    expect(textContent(tree.root)).toContain('找不到这条记录');
  });

  it('does not tell the operator to look up a file name nobody recorded', async () => {
    // `recordFullExportAudit` is the only writer that puts `fileName` in
    // an audit payload and it runs only for the FULL csv. This export
    // leaves `requireAdmin`'s row, whose payload is fixed at
    // {adminUserId, targetUserId, path, method}.
    ready();
    mockExport.mockResolvedValue({ blob: { size: 2048 } as unknown as Blob, fileName: null });
    const tree = await render();
    await pressByLabel(tree, '导出 TREAT-NMD');

    const screen = textContent(tree.root);
    expect(screen).toContain('服务端文件名未收到');
    expect(screen).toContain('没有留在任何地方');
    expect(screen).not.toContain('payload 的 fileName');
  });

  it('says the exported baseline is not the one in the boxes above', async () => {
    // `exportPatient` builds the document from `getProfileByUserId`,
    // which runs `applyGeneticReportAutofill` at read time; the edit
    // form above is the stored column. An operator comparing the two
    // and finding a D4Z4 in one of them needs to know which is which.
    ready();
    const screen = textContent((await render()).root);
    expect(screen).toContain('自动补上');
    expect(screen).toContain('编辑框里是数据库存的原值');
  });
});

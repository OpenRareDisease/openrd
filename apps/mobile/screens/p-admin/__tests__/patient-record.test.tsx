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

import { ADMIN_AUDIT_NOTICE } from '../common';
import AdminPatientRecordScreen from '../patient-record';
import styles from '../styles';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const textContent = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => textContent(child as ReactTestInstance)).join('');
};

/**
 * The text of ONE read-only field's row, so a per-field assertion
 * cannot be satisfied by a sentence printed somewhere else on the
 * page — which is the whole question here, since the two reasons a
 * field can be read-only are both on this screen.
 *
 * Matched on `styles.stat`, the style `RecordLine` puts on its own
 * root: text alone cannot separate a row from the block that contains
 * it.
 */
const rowFor = (tree: TestRenderer.ReactTestRenderer, label: string): string =>
  tree.root
    .findAll(
      (node) =>
        Array.isArray(node.props?.style) &&
        node.props.style.includes(styles.stat) &&
        textContent(node).startsWith(label),
    )
    .map((node) => textContent(node))[0] ?? '';

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
    // 「no entry for this path」 means no marker was recorded, and it
    // means even that only when the list itself arrived.
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

describe('a genetic result has no box, and the screen says why', () => {
  const GENETIC_LABELS = ['FSHD 分型', 'D4Z4 重复数', '单倍型', '甲基化'];

  it('draws no text box for any of them', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    const editable = tree.root
      .findAll((node) => typeof node.props?.onChangeText === 'function')
      .map((node) => String(node.props.accessibilityLabel ?? ''));
    // The boxes an operator does get are there, so this is not passing
    // on a screen that failed to render a form at all.
    expect(editable.some((label) => label.startsWith('姓名'))).toBe(true);
    for (const label of GENETIC_LABELS) {
      expect(editable.some((candidate) => candidate.startsWith(label))).toBe(false);
    }
  });

  it('shows the stored value and the reason it cannot be typed', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    // Seeing the value is the point — an operator on the phone has to be
    // able to read back what is on file.
    expect(rowFor(tree, 'D4Z4 重复数')).toContain('4/22');

    for (const label of GENETIC_LABELS) {
      // Refused for being a measurement, not for being self-report.
      // Told a D4Z4 is 患者对自己身体的回答, an operator reading it off a
      // laboratory report takes the refusal for a bug. What each group
      // says instead is pinned per group below.
      expect(rowFor(tree, label)).not.toContain('这是患者对自己身体的回答');
    }

    // The patient-only fields keep their own reason, on their own rows.
    expect(rowFor(tree, '足下垂')).toContain('这是患者对自己身体的回答');
    expect(rowFor(tree, '足下垂')).not.toContain('基因报告');
  });

  it('sends the operator to the patient’s own form for the ones he can type', async () => {
    // 分型 and D4Z4 have a box on p-register_profile, reached from
    // 我的 → 编辑资料, and what the patient types there is what the PUT
    // carries. A row that offers only 「让他上传报告」 sends an operator
    // to re-upload a laboratory report for a value the patient could
    // retype in a minute.
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    for (const label of ['FSHD 分型', 'D4Z4 重复数']) {
      const row = rowFor(tree, label);
      expect(row).toContain('编辑资料');
      // Still no box HERE, and still for the reason it was refused: the
      // number is a measurement, not something a phone call produces.
      expect(row).toContain('这一项后台不能填');
    }
  });

  it('gives the ones with no box no script to read out', async () => {
    // 单倍型 and 甲基化 have no box on this screen and none on the
    // patient's form, and the server refuses them from an
    // administrator. The row used to hand the operator the steps for
    // correcting the report instead — 「打开那份报告，点「识别有误？手动
    // 修正」」 — and that control is drawn only for a `parsed` or
    // `needs_review` row, which this screen cannot vouch for: it holds
    // the status as of page load and a 重新识别 tap moves it. So the row
    // names where the decision is made and describes no control.
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    for (const label of ['单倍型', '甲基化']) {
      const row = rowFor(tree, label);
      expect(row).not.toContain('识别有误');
      expect(row).not.toContain('手动修正');
      // No promise either way about a re-upload: whether one is needed
      // is the same thing this screen cannot see.
      expect(row).not.toContain('不用让他重新上传');
      expect(row).not.toContain('请他上传新的报告');
      // The remedy that works for the other pair does not work here:
      // pointing at 编辑资料 is pointing at a screen with no box.
      expect(row).not.toContain('请他自己在编辑资料里改');
      // Nor does it claim the value has no recorded origin: the row
      // carries an origin chip and a legacy marker can sit on these
      // paths, so a sentence saying nothing was recorded would deny
      // what the same row is showing.
      expect(row).not.toContain('没有留下记录');
      // What is left: nobody here can type it, and the report's own
      // page is where a correction to a reading is decided.
      expect(row).toContain('本平台这边现在没有人能改');
      expect(row).toContain('那份报告自己的页面');
    }
  });

  it('still shows a stored marker on a field it cannot type', async () => {
    // Such a profile exists. The value is in the column and the marker
    // is on it, and the screen whose job is to mark it must go on
    // marking it — with who and when, not just a chip.
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
    const screen = textContent((await render()).root);

    expect(screen).toContain('管理员代填');
    expect(screen).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(screen).toContain('4/22');
  });
});

describe('an empty genetic row does not say the patient left it blank', () => {
  /**
   * This page shows the STORED column. The patient's own screens and
   * the export do not — `applyGeneticReportAutofill` fills a missing
   * genetic result out of his latest report on the way out. So a
   * genetic field is routinely empty here and printed on his passport
   * at the same time, and for 单倍型 and 甲基化, which nothing writes
   * into the column, that is the ordinary case.
   *
   * 未填 is a claim about the patient. An operator reading it off this
   * row tells him he never filled in a value he is looking at.
   */
  const missingGenetics = () =>
    recordBody({
      baseline: {
        foundation: { fullName: '张三', birthYear: 1988 },
        diseaseBackground: {},
      },
      documents: [
        {
          id: 'doc-1',
          title: '基因检测报告',
          documentType: 'genetic_report',
          status: 'parsed',
          uploadedAt: '2026-07-20T02:00:00.000Z',
        },
      ],
    });

  it('says the baseline has none, not that the patient filed none', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(missingGenetics()));
    const tree = await render();

    for (const label of ['FSHD 分型', 'D4Z4 重复数', '单倍型', '甲基化']) {
      const row = rowFor(tree, label);
      expect(row).toContain('基线里没有');
      expect(row).not.toContain('未填');
      // And where to look before saying anything to the patient.
      expect(row).toContain('先看这一页的报告列表');
    }
  });

  it('leaves 未填 on the answers the patient really did not give', async () => {
    // Nothing fills in a self-report field behind the patient's back,
    // so an empty one means what it says. Replacing 未填 everywhere
    // would trade one false sentence for another.
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(missingGenetics()));
    const tree = await render();

    expect(rowFor(tree, '足下垂')).toContain('未填');
    expect(rowFor(tree, '足下垂')).not.toContain('基线里没有');
  });

  it('still prints a stored genetic value when the column has one', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    const row = rowFor(tree, 'D4Z4 重复数');
    expect(row).toContain('4/22');
    // The empty-row note is about an empty row. On a filled one it
    // reads as a warning against a value that is right there.
    expect(row).not.toContain('基线里没有');
  });

  it('draws the 报告 list it tells the operator to look at', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(missingGenetics()));
    const screen = textContent((await render()).root);

    expect(screen).toContain('基因检测报告');
  });
});

describe('saving', () => {
  it('sends the whole baseline, not just the edited field', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();

    await typeInto(tree, '起病部位', '肩带');
    await pressByLabel(tree, '保存 1 处改动');

    expect(mockConfirm).toHaveBeenCalled();
    // The third argument is the version these boxes were filled from.
    // It becomes If-Match, and it is what lets the server refuse a
    // whole-baseline payload built before the patient's own edit.
    //
    // `d4z4` rides along untouched. It has no box on this screen, and
    // it still has to be in the payload: `upsertBaseline` replaces the
    // column, so leaving it out is an erase.
    expect(mockUpdateBaseline).toHaveBeenCalledWith(
      USER_ID,
      {
        foundation: { fullName: '张三', birthYear: 1988 },
        diseaseBackground: { d4z4: '4/22', onsetRegion: '肩带' },
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

    await typeInto(tree, '起病部位', '肩带');
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
    expect(textContent(tree.root)).toContain('经过了自动补全');
  });
});

/**
 * NOTHING ON THIS SCREEN MAY TELL AN OPERATOR A GENETIC REPORT SUPPLIED
 * A VALUE.
 *
 * The three notices about the read-time autofill each named 基因报告 as
 * where the filled value comes from. `pickGeneticEvidenceDocument` takes
 * a 病历摘要 quoting the results whenever the genetics report read out
 * nothing, and a large share of these patients have never uploaded a
 * genetics report at all — so the sentence an operator reads out on the
 * phone asserted a document that does not exist, on the one screen whose
 * whole job is to keep him from saying something the record cannot back.
 *
 * This screen cannot see which document was picked: it renders the
 * stored column and a list of rows. So the claim is gone rather than
 * qualified, and what stays is the instruction — look at the list.
 */
describe('后台不替某一类文件背书', () => {
  it('说自动补全是从上传的文件来的，不说是从基因报告来的', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();
    const screen = textContent(tree.root);

    expect(screen).toContain('会用他上传的文件里读到的值补上缺的基因结果');
    expect(screen).not.toContain('会用他已上传的基因报告里的值');
    expect(screen).not.toContain('从他已上传的基因报告里自动补上');

    // The instruction the note exists for is untouched: an empty row
    // here is not 「你没填」, and the answer is in the list below.
    expect(screen).toContain('别在电话里说「你没填」');
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
    await typeInto(tree, '起病部位', '肩带');
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
    // 121 characters against `nullableText(120)` on
    // diseaseBackground.onsetRegion. Reachable in practice because a
    // value stored before that cap arrived is shown in full, and the
    // box's own maxLength does not shorten what is already there.
    mockGetRecord.mockResolvedValue(
      actual.readAdminPatientRecord(
        recordBody({
          baseline: {
            foundation: { fullName: '张三' },
            diseaseBackground: { onsetRegion: '肩'.repeat(121) },
          },
        }),
      ),
    );
    const tree = await render();
    await typeInto(tree, '起病部位', `${'肩'.repeat(120)}带`);
    await pressByLabel(tree, '保存 1 处改动');

    expect(mockUpdateBaseline).not.toHaveBeenCalled();
    const screen = textContent(tree.root);
    expect(screen).toContain('「起病部位」最多 120 个字，现在是 121 个');
  });

  it('caps the box at the number the server accepts', async () => {
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const tree = await render();
    const box = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('起病部位') &&
        typeof node.props?.onChangeText === 'function',
    );
    expect(box.props.maxLength).toBe(120);
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

describe('the audit banner is true on the one page whose rows do name a patient', () => {
  it('draws the one notice over the record whose read was audited with this patient', async () => {
    // The half of the banner that survives: `getPatientRecord` is
    // mounted with `targetParam: 'userId'`, so the row written before
    // this screen got its data carries this patient's id. The
    // subtitle says the same thing in the first person, and the two
    // are the reason the banner still mentions a patient at all
    // instead of the sentence being deleted outright.
    const actual = jest.requireActual('../../../lib/admin-api');
    mockGetRecord.mockResolvedValue(actual.readAdminPatientRecord(recordBody()));
    const screen = textContent((await render()).root);
    expect(screen).toContain(ADMIN_AUDIT_NOTICE);
    expect(screen).toContain('打开这一页时已经写了一条读取审计记录');
  });
});

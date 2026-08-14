import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * The re-consent screen tells a patient that a 「管理员代填」 marker
 * comes off when they type the field in again. This file holds that
 * sentence against the two screens it is a claim about: the back
 * office, which decides which fields can carry a marker at all, and
 * the patient's own form, which decides which of them the patient can
 * ever put in `applyPatientBaselineWrite`'s changed set.
 *
 * The gap this pins shut: a field the back office can write and the
 * patient's form has no control for keeps its marker for the life of
 * the account, and the marker is printed on the clinical passport, the
 * PDF, the share page a neurologist opens and all three exports. The
 * copy has to name that field and send the patient somewhere that
 * works — so this file fails when the two screens and the copy stop
 * agreeing, rather than when a patient goes looking for a box that is
 * not there.
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

let mockParams: Record<string, string> = {};
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));

jest.mock('../feature-flags', () => ({ __esModule: true, isFeatureEnabled: () => false }));

jest.mock('../../screens/common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader') };
});

jest.mock('../../screens/common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), notify: jest.fn() }),
}));

// The two pickers are native modules under jest. Each stands in as a
// single pressable that reports one fixed answer, which is all the
// form needs to move 出生年份 and 所在地区 off their stored values.
// Both answers differ from what `storedProfile` loads, so pressing one
// is a move and leaving it alone is not.
jest.mock('../../screens/common/DemographicsPickers', () => {
  const ReactLocal = require('react');
  const { Text } = require('react-native');
  return {
    BirthDatePickers: ({ onChange }: { onChange: (next: unknown) => void }) =>
      ReactLocal.createElement(Text, {
        accessibilityLabel: 'set-birth-date',
        onPress: () => onChange({ year: '2001', month: '06', day: '07' }),
      }),
    RegionPickers: ({ onChange }: { onChange: (next: unknown) => void }) =>
      ReactLocal.createElement(Text, {
        accessibilityLabel: 'set-region',
        onPress: () => onChange({ province: '四川省', city: '成都市', district: '武侯区' }),
      }),
  };
});

jest.mock('../../screens/p-privacy_settings/components/SensitiveDataConsentGate', () => ({
  __esModule: true,
  default: () => null,
  useSensitiveDataConsentGate: () => ({
    ensureSensitiveDataConsent: jest.fn().mockResolvedValue(true),
    gateProps: {},
  }),
}));

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: {
      phoneNumber: '13900000000',
      email: null,
      role: 'patient',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    logout: jest.fn(),
  }),
}));

jest.mock('../../contexts/ProfileContext', () => ({
  useProfileContext: () => ({ refresh: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

const mockGetRecord = jest.fn();
jest.mock('../admin-api', () => {
  const actual = jest.requireActual('../admin-api');
  return {
    ...actual,
    getAdminPatientRecord: (...args: unknown[]) => mockGetRecord(...args),
    updateAdminPatientBaseline: jest.fn().mockResolvedValue(undefined),
    exportAdminPatient: jest.fn().mockResolvedValue(undefined),
  };
});

const mockGetMyPatientProfile = jest.fn();
const mockUpdateMyBaseline = jest.fn();
jest.mock('../api', () => {
  const actual = jest.requireActual('../api');
  return {
    ...actual,
    getMyPatientProfile: (...args: unknown[]) => mockGetMyPatientProfile(...args),
    upsertPatientProfile: jest.fn().mockResolvedValue({}),
    updateMyBaseline: (...args: unknown[]) => mockUpdateMyBaseline(...args),
    // 我的 probes these on mount; the copy's route claim is about the
    // row it draws, not about what the deletion endpoint answers.
    exportMyData: jest.fn(),
    requestAccountDeletion: jest.fn(),
    cancelAccountDeletion: jest.fn(),
    getAccountDeletionStatus: jest.fn().mockResolvedValue({ deletion: null }),
  };
});

import { GUARDIAN_CONSENT_SECTIONS, PRIVACY_POLICY_SECTIONS } from '../legal-content';
import {
  ADMIN_FILLED_BASELINE_FIELDS,
  ADMIN_FILLED_FIELDS_WITHOUT_PATIENT_INPUT,
  LEGAL_VERSION_NOTES,
  LEGAL_DOCUMENT_SECTIONS,
} from '../legal-updates';
import { LEGAL_DOCUMENTS } from '../legal-content';
import AdminPatientRecordScreen from '../../screens/p-admin/patient-record';
import RegisterProfileScreen from '../../screens/p-register_profile';
import SettingsScreen from '../../screens/p-settings';

const USER_ID = '11111111-1111-4111-8111-111111111111';

const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

const render = async (element: React.ReactElement) => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(element);
    await flush();
  });
  return tree;
};

const editableInputs = (tree: TestRenderer.ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll(
    (node) => typeof node.type !== 'string' && typeof node.props?.onChangeText === 'function',
  );

const valueAtPath = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, source);

/** A baseline holding a distinct value for every field the back office
 *  can write, so a payload that moved one of them is visible and one
 *  that carried it forward is too. */
const storedBaseline = () => ({
  foundation: {
    fullName: '张三',
    preferredName: '三哥',
    regionLabel: '上海市 浦东新区',
    birthYear: 1988,
    diagnosisYear: 2019,
  },
  diseaseBackground: {
    diagnosisType: 'FSHD1',
    d4z4: '6',
    haplotype: '4qA',
    methylation: '25%',
    familyHistory: '母亲疑似',
    onsetRegion: '肩胛带',
  },
  currentStatus: { independentlyAmbulatory: true, assistiveDevices: [] },
  notes: '电话里转述的',
});

/**
 * What `GET /profiles/me` answers once an administrator has
 * transcribed that baseline — the identity columns and the baseline
 * DISAGREEING, which is the state the per-field promise is hardest in.
 *
 * `upsertBaseline` (apps/api) mirrors `foundation.fullName` into
 * `full_name` and `foundation.regionLabel` into `region_city`, and
 * nothing mirrors `foundation.birthYear` anywhere. So after the back
 * office writes 出生年份 1988 and 所在地区「上海市 浦东新区」, the
 * profile's own `date_of_birth` still holds whatever the patient's
 * onboarding put there, `region_city` holds the whole label, and
 * `region_province` / `region_district` still hold the patient's own
 * answers. Those four columns are what the 出生日期 and 省 / 市 / 区县
 * controls on the patient's form are filled from — which is why a save
 * that rebuilt the two baseline fields from them would post values the
 * patient never looked at.
 */
const storedProfile = () => ({
  fullName: '张三',
  dateOfBirth: '1979-03-04',
  gender: 'male',
  regionProvince: '四川省',
  regionCity: '上海市 浦东新区',
  regionDistrict: '武侯区',
  baseline: storedBaseline(),
});

const pressSave = async (tree: TestRenderer.ReactTestRenderer) => {
  await act(async () => {
    const save = tree.root
      .findAll((node) => typeof node.type !== 'string' && node.props?.label === '保存')
      .find((node) => typeof node.props?.onPress === 'function');
    if (!save) throw new Error('保存 按钮不在这张表单上');
    save.props.onPress();
    await flush();
  });
};

beforeEach(() => {
  mockParams = {};
  mockPush.mockReset();
  mockGetRecord.mockReset();
  mockGetMyPatientProfile.mockReset();
  mockUpdateMyBaseline.mockReset().mockResolvedValue({});
});

describe('文案里那条路真的走得通', () => {
  it('「我的」上有一个「编辑资料」，按下去打开的就是这张基线表单', async () => {
    const tree = await render(<SettingsScreen />);
    const control = tree.root
      .findAll((node) => typeof node.type !== 'string' && node.props?.label === '编辑资料')
      .find((node) => typeof node.props?.onPress === 'function');
    if (!control) throw new Error('「我的」上没有「编辑资料」这个控件');
    await act(async () => {
      control.props.onPress();
      await flush();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-register_profile');
  });
});

describe('这份名单说的就是后台真画了框的那些字段', () => {
  it('后台每一个能填的框，名单里都有一项，反过来也是', async () => {
    mockParams = { userId: USER_ID };
    const adminApi = jest.requireActual('../admin-api');
    mockGetRecord.mockResolvedValue(
      adminApi.readAdminPatientRecord({
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
          preferredName: '三哥',
          patientCode: 'FSHD-0001',
          regionLabel: '上海市 浦东新区',
          updatedAt: '2026-08-01T02:00:00.000Z',
        },
        baseline: storedBaseline(),
        baselineIsStored: true,
        fieldOrigins: [],
        documents: [],
        followups: [],
        falls: [],
        instruments: [],
      }),
    );

    const tree = await render(<AdminPatientRecordScreen />);
    // Each editable row labels its box 「字段名（来源）」 — the field
    // name is everything ahead of that bracket.
    const drawn = editableInputs(tree)
      .map((node) => String(node.props.accessibilityLabel).split('（')[0])
      .sort();

    expect(drawn).toEqual(ADMIN_FILLED_BASELINE_FIELDS.map((field) => field.label).sort());
  });
});

describe('名单说患者能自己收回的，患者的表单上真的写得到', () => {
  it('保存时发出去的 baseline，动了该动的那些字段，没动其余的', async () => {
    mockGetMyPatientProfile.mockResolvedValue(storedProfile());

    const tree = await render(<RegisterProfileScreen />);

    // Every box on the form gets a new value, not a hand-picked few:
    // a field added to the form later is then driven by this test
    // without anyone extending it. 邮箱 is the one exception — the
    // form refuses to save on a malformed address, so it gets one
    // that parses.
    await act(async () => {
      editableInputs(tree).forEach((node) =>
        node.props.onChangeText(
          String(node.props.placeholder).includes('邮箱') ? 'someone@example.com' : '2001',
        ),
      );
      await flush();
    });
    await act(async () => {
      tree.root
        .findAll(
          (node) =>
            typeof node.props?.accessibilityLabel === 'string' &&
            ['set-birth-date', 'set-region'].includes(node.props.accessibilityLabel),
        )
        .forEach((node) => node.props.onPress());
      await flush();
    });
    await pressSave(tree);

    const payload = mockUpdateMyBaseline.mock.calls[0]?.[0];
    expect(payload).toBeDefined();

    const stored = storedBaseline();
    for (const field of ADMIN_FILLED_BASELINE_FIELDS) {
      const sent = valueAtPath(payload, field.path);
      if (field.patientEditable) {
        // Different from what was stored, so the leaf path lands in
        // `changedLeafPaths` and the server releases the marker.
        expect({ [field.path]: sent }).not.toEqual({
          [field.path]: valueAtPath(stored, field.path),
        });
      } else {
        // Carried forward byte for byte by the payload's spreads. No
        // sequence of taps on this form can put it in the changed set,
        // which is why the copy sends the patient elsewhere for it.
        expect({ [field.path]: sent }).toEqual({ [field.path]: valueAtPath(stored, field.path) });
      }
    }
  });

  /**
   * 「你改哪一个就只放开哪一个」, held against a save where the patient
   * changed NOTHING.
   *
   * 出生年份 and 所在地区 are the two the sentence is hard for: their
   * controls are filled from the profile's own columns, which an
   * administrator writing the baseline field does not touch, so the
   * form is looking at one answer while the baseline holds another.
   * A save that rebuilt them from the controls would post a value the
   * patient never entered, `applyPatientBaselineWrite` would count the
   * leaf path as changed, and the 「管理员代填」 marker would come off a
   * field they never opened — on a save about 分型, or about nothing.
   */
  it('什么都没动的那一次保存，十二项一项都没被改写', async () => {
    mockGetMyPatientProfile.mockResolvedValue(storedProfile());

    const tree = await render(<RegisterProfileScreen />);
    await pressSave(tree);

    const payload = mockUpdateMyBaseline.mock.calls[0]?.[0];
    expect(payload).toBeDefined();

    const stored = storedBaseline();
    for (const field of ADMIN_FILLED_BASELINE_FIELDS) {
      expect({ [field.path]: valueAtPath(payload, field.path) }).toEqual({
        [field.path]: valueAtPath(stored, field.path),
      });
    }
  });

  it.each([
    ['出生日期', 'foundation.birthYear', 'set-birth-date'],
    ['省 / 市 / 区县', 'foundation.regionLabel', 'set-region'],
  ])('只动「%s」，变的就只有 %s', async (_control, movedPath, picker) => {
    mockGetMyPatientProfile.mockResolvedValue(storedProfile());

    const tree = await render(<RegisterProfileScreen />);
    await act(async () => {
      tree.root
        .findAll((node) => node.props?.accessibilityLabel === picker)
        .forEach((node) => node.props.onPress());
      await flush();
    });
    await pressSave(tree);

    const payload = mockUpdateMyBaseline.mock.calls[0]?.[0];
    expect(payload).toBeDefined();

    const stored = storedBaseline();
    for (const field of ADMIN_FILLED_BASELINE_FIELDS) {
      const sent = valueAtPath(payload, field.path);
      const expected = { [field.path]: valueAtPath(stored, field.path) };
      if (field.path === movedPath) {
        expect({ [field.path]: sent }).not.toEqual(expected);
      } else {
        expect({ [field.path]: sent }).toEqual(expected);
      }
    }
  });
});

describe('改不了的那些字段，四处文案都点了名，并且给了一条走得通的路', () => {
  const privacyNote = LEGAL_VERSION_NOTES[LEGAL_DOCUMENTS.privacyPolicy]
    .flatMap((note) => note.changes)
    .join('\n');
  const guardianNote = LEGAL_VERSION_NOTES[LEGAL_DOCUMENTS.guardianConsent]
    .flatMap((note) => note.changes)
    .join('\n');
  const privacyText = PRIVACY_POLICY_SECTIONS.map((section) => section.body).join('\n');
  const guardianText = GUARDIAN_CONSENT_SECTIONS.map((section) => section.body).join('\n');

  const copies: Array<[string, string]> = [
    ['隐私政策的改动摘要', privacyNote],
    ['儿童规则的改动摘要', guardianNote],
    ['隐私政策全文', privacyText],
    ['儿童规则全文', guardianText],
  ];

  it.each(copies)('%s 点了每一个 App 内改不掉的字段的名', (_where, text) => {
    for (const field of ADMIN_FILLED_BASELINE_FIELDS) {
      if (field.patientEditable) continue;
      expect(text).toContain(field.label);
    }
  });

  it.each(copies)('%s 同时给出自己改的地方和改不了时找谁', (_where, text) => {
    // The form really is reached this way: 我的 draws a 编辑资料
    // control that pushes /p-register_profile.
    expect(text).toContain('编辑资料');
    // 第 1 条 carries the mailbox and the phone number, and §7 already
    // promises we act on a request that arrives there.
    expect(text).toContain('第 1 条');
  });

  it('名字和「没有输入框」是连在一句话里的，不是各说各的', () => {
    // Naming the fields somewhere and admitting the limitation
    // somewhere else lets a reader take the promise home and meet the
    // missing box later. The bullet says both in one clause, built off
    // the same list this file checks the screens against.
    expect(ADMIN_FILLED_FIELDS_WITHOUT_PATIENT_INPUT.length).toBeGreaterThan(0);
    expect(privacyNote).toContain(
      ADMIN_FILLED_FIELDS_WITHOUT_PATIENT_INPUT + '这几项，App 里没有给你填的地方',
    );
    expect(guardianNote).toContain(
      ADMIN_FILLED_FIELDS_WITHOUT_PATIENT_INPUT + '这几项 App 里没有给监护人填的地方',
    );
  });

  it.each([
    ['隐私政策', LEGAL_DOCUMENTS.privacyPolicy],
    ['儿童规则', LEGAL_DOCUMENTS.guardianConsent],
  ])('%s 的这几句就在重新同意那一页的展开全文里', (_title, document) => {
    // The screen renders `ask.notes` above and, behind 展开全文, every
    // section of `ask.sections` — which is this map.
    const sections = LEGAL_DOCUMENT_SECTIONS[document].map((section) => section.body).join('\n');
    for (const field of ADMIN_FILLED_BASELINE_FIELDS) {
      if (field.patientEditable) continue;
      expect(sections).toContain(field.label);
    }
    expect(sections).toContain('编辑资料');
  });
});

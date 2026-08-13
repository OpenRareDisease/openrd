/**
 * The five-rung diagnosis ladder, on the form that writes it.
 *
 * The API has graded genetic evidence off `diseaseBackground.
 * diagnosisLadder` for a while — it decides whether the passport says
 * 「还没有做过能测出 FSHD 的基因检测」 or stays at 未知, and it is what
 * the 《检查申请说明》 opens with. Nothing wrote it. The field existed,
 * was validated, was read by the passport builder, and no screen in the
 * app could put a value in it, so every profile carried `null` and the
 * grade fell to 未知 for the entire population.
 *
 * What these tests hold down:
 *
 *   1. The five options are the API's five, spelled the API's way.
 *      `z.enum(DIAGNOSIS_LADDER_STATES)` rejects the whole baseline on
 *      a drifted value, and a drifted *label* is worse — it asks a
 *      different question than the one the passport answers.
 *   2. Answering it is health data. `PUT /me/baseline` is behind
 *      `requireSensitiveDataConsent`, and「我已确诊 FSHD」is exactly the
 *      kind of thing PIPL Art. 29 is about.
 *   3. Not answering it stays not-answered. There is no inverse of
 *      `diagnosedFshdFromLadder`, so a guessed rung cannot be undone by
 *      the server later.
 */

import TestRenderer, { act } from 'react-test-renderer';
import RegisterProfileScreen from '../index';
import { DIAGNOSIS_LADDER_LABELS } from '../../../lib/api';

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../common/DemographicsPickers', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    BirthDatePickers: ({ onChange }: { onChange: (next: unknown) => void }) =>
      React.createElement(Text, {
        accessibilityLabel: 'set-birth-date',
        onPress: () => onChange({ year: '1988', month: '05', day: '12' }),
      }),
    RegionPickers: ({ onChange }: { onChange: (next: unknown) => void }) =>
      React.createElement(Text, {
        accessibilityLabel: 'set-region',
        onPress: () => onChange({ province: '上海市', city: '上海市', district: '浦东新区' }),
      }),
  };
});

jest.mock('../../common/ScreenHeader', () => () => null);

const mockEnsureGuardianConsent = jest.fn().mockResolvedValue(true);
const mockEnsureSensitiveDataConsent = jest.fn().mockResolvedValue(true);
jest.mock('../../p-privacy_settings/components/SensitiveDataConsentGate', () => ({
  __esModule: true,
  default: () => null,
  useSensitiveDataConsentGate: (document: string) => ({
    ensureSensitiveDataConsent:
      document === 'guardian_consent' ? mockEnsureGuardianConsent : mockEnsureSensitiveDataConsent,
    gateProps: {},
  }),
}));

const mockUpsertPatientProfile = jest.fn().mockResolvedValue({});
const mockUpdateMyBaseline = jest.fn().mockResolvedValue({});
const mockGetMyPatientProfile = jest.fn();
jest.mock('../../../lib/api', () => {
  // Only the network functions are faked. The ladder constants are the
  // point of the test, so they come from the real module — a mocked
  // copy of the labels would assert that the test agrees with itself.
  const actual = jest.requireActual('../../../lib/api');
  class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    __esModule: true,
    DIAGNOSIS_LADDER_STATES: actual.DIAGNOSIS_LADDER_STATES,
    DIAGNOSIS_LADDER_LABELS: actual.DIAGNOSIS_LADDER_LABELS,
    ApiError,
    getMyPatientProfile: (...args: unknown[]) => mockGetMyPatientProfile(...args),
    upsertPatientProfile: (...args: unknown[]) => mockUpsertPatientProfile(...args),
    updateMyBaseline: (...args: unknown[]) => mockUpdateMyBaseline(...args),
  };
});

const mockSetSessionValue = jest.fn().mockResolvedValue(undefined);
const mockGetSessionValue = jest.fn().mockResolvedValue(null);
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: (...args: unknown[]) => mockGetSessionValue(...args),
  setSessionValue: (...args: unknown[]) => mockSetSessionValue(...args),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { phoneNumber: '13900000000', email: null } }),
}));

jest.mock('../../../contexts/ProfileContext', () => ({
  useProfileContext: () => ({ refresh: jest.fn().mockResolvedValue(undefined) }),
}));

jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ notify: jest.fn() }),
}));

const renderScreen = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<RegisterProfileScreen />);
  });
  await act(async () => {});
  return tree;
};

const pressable = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function',
  )[0];

const pressLabel = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  await act(async () => {
    pressable(tree, label).props.onPress();
  });
};

/** Everything the non-onboarding form requires, minus the ladder. */
const fillRequiredFields = async (tree: TestRenderer.ReactTestRenderer) => {
  await act(async () => {
    tree.root.find((node) => node.props?.placeholder === '请输入姓名').props.onChangeText('张三');
  });
  await pressLabel(tree, 'set-birth-date');
  await pressLabel(tree, '男');
  await pressLabel(tree, 'set-region');
};

const save = async (tree: TestRenderer.ReactTestRenderer) => {
  await act(async () => {
    pressable(tree, '保存').props.onPress();
  });
};

const savedBaseline = () => mockUpdateMyBaseline.mock.calls[0]?.[0];

beforeEach(() => {
  mockReplace.mockClear();
  mockEnsureGuardianConsent.mockClear().mockResolvedValue(true);
  mockEnsureSensitiveDataConsent.mockClear().mockResolvedValue(true);
  mockUpsertPatientProfile.mockClear().mockResolvedValue({});
  mockUpdateMyBaseline.mockClear().mockResolvedValue({});
  mockGetSessionValue.mockReset().mockResolvedValue(null);
  mockSetSessionValue.mockReset().mockResolvedValue(undefined);
  mockGetMyPatientProfile
    .mockReset()
    .mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
});

describe('诊断进度：五级阶梯真的被写出去了', () => {
  it('五个选项按 API 的顺序和措辞呈现', async () => {
    const tree = await renderScreen();
    // Order matters: the API declares index 0 as the most complete
    // evidence and index 4 the least, precisely so a screen can render
    // it as a ladder without inventing an order.
    const rendered = tree.root
      .findAll(
        (node) =>
          node.props?.accessibilityRole === 'radio' &&
          Object.values(DIAGNOSIS_LADDER_LABELS).includes(node.props.accessibilityLabel),
      )
      .map((node) => node.props.accessibilityLabel as string)
      // TouchableOpacity passes its props through several layers, so
      // each option turns up more than once. Order is what this test is
      // about, so collapse the repeats rather than pinning a layer.
      .filter((label, index, all) => label !== all[index - 1]);
    expect(rendered).toEqual([
      '已确诊，基因报告在手上',
      '已确诊，但报告不在手上',
      '临床诊断，还没做过基因检测',
      '还没测过，想测',
      '还没测过，暂时不打算测',
    ]);
  });

  it('选中「临床诊断，还没做过基因检测」后，baseline 里带着 clinical_only', async () => {
    const tree = await renderScreen();
    await fillRequiredFields(tree);
    await pressLabel(tree, '临床诊断，还没做过基因检测');
    await save(tree);

    expect(mockUpdateMyBaseline).toHaveBeenCalledTimes(1);
    expect(savedBaseline()).toMatchObject({
      diseaseBackground: { diagnosisLadder: 'clinical_only' },
    });
  });

  it('「已确诊，但报告不在手上」不会被折叠成别的一级', async () => {
    // The rung this whole enum exists for: it used to answer the old
    // boolean `true` and was then read downstream as a molecular
    // diagnosis, so the app had no way to say the one useful thing —
    // the report exists and can be requested back.
    const tree = await renderScreen();
    await fillRequiredFields(tree);
    await pressLabel(tree, '已确诊，但报告不在手上');
    await save(tree);

    expect(savedBaseline().diseaseBackground.diagnosisLadder).toBe('confirmed_report_unavailable');
  });

  it('答这一题就是敏感个人信息 —— 单独同意先问，没同意就不写', async () => {
    mockEnsureSensitiveDataConsent.mockResolvedValue(false);
    const tree = await renderScreen();
    await fillRequiredFields(tree);
    await pressLabel(tree, '还没测过，想测');
    await save(tree);

    expect(mockEnsureSensitiveDataConsent).toHaveBeenCalledTimes(1);
    expect(mockUpdateMyBaseline).not.toHaveBeenCalled();
    expect(mockUpsertPatientProfile).not.toHaveBeenCalled();
  });

  it('不答的时候既不问同意，也不写 baseline', async () => {
    const tree = await renderScreen();
    await fillRequiredFields(tree);
    await save(tree);

    expect(mockEnsureSensitiveDataConsent).not.toHaveBeenCalled();
    expect(mockUpdateMyBaseline).not.toHaveBeenCalled();
    expect(mockUpsertPatientProfile).toHaveBeenCalledTimes(1);
  });

  it('再点一次已选中的那一级可以取消 —— 五个选项里没有「不想说」', async () => {
    const tree = await renderScreen();
    await fillRequiredFields(tree);
    await pressLabel(tree, '还没测过，暂时不打算测');
    await pressLabel(tree, '还没测过，暂时不打算测');
    // Filled so there is still something to write; otherwise the save
    // would skip the baseline for an unrelated reason.
    await act(async () => {
      tree.root
        .find((node) => node.props?.placeholder === '例如：FSHD1')
        .props.onChangeText('FSHD1');
    });
    await save(tree);

    expect(savedBaseline().diseaseBackground.diagnosisLadder).toBeNull();
  });

  it('已存的那一级会回填并原样带回去', async () => {
    mockGetMyPatientProfile.mockReset().mockResolvedValue({
      fullName: '张三',
      dateOfBirth: '1988-05-12',
      gender: '男',
      contactPhone: '13900000000',
      regionProvince: '上海市',
      regionCity: '上海市',
      regionDistrict: '浦东新区',
      baseline: { diseaseBackground: { diagnosisLadder: 'confirmed_with_report' } },
    });
    const tree = await renderScreen();

    expect(pressable(tree, '已确诊，基因报告在手上').props.accessibilityState).toEqual({
      selected: true,
    });

    await save(tree);
    expect(savedBaseline().diseaseBackground.diagnosisLadder).toBe('confirmed_with_report');
  });

  it('存着一个这版认不出的值时，回到「未回答」，不原样发回去', async () => {
    // `baseline` is untyped JSONB and reaches the client through an
    // unchecked type assertion. Posting an unknown string back gets the
    // WHOLE baseline rejected by the server's z.enum, and the patient
    // sees 「保存失败」 on a form where every visible field is fine.
    mockGetMyPatientProfile.mockReset().mockResolvedValue({
      fullName: '张三',
      dateOfBirth: '1988-05-12',
      gender: '男',
      contactPhone: '13900000000',
      regionProvince: '上海市',
      regionCity: '上海市',
      regionDistrict: '浦东新区',
      baseline: { diseaseBackground: { diagnosisLadder: 'confirmed_by_vibes', d4z4: '4' } },
    });
    const tree = await renderScreen();

    Object.values(DIAGNOSIS_LADDER_LABELS).forEach((label) => {
      expect(pressable(tree, label).props.accessibilityState).toEqual({ selected: false });
    });

    await save(tree);
    expect(savedBaseline().diseaseBackground.diagnosisLadder).toBeNull();
  });

  it('本机草稿里的坏值同样不会盖过服务端的好值', async () => {
    mockGetSessionValue.mockResolvedValue(JSON.stringify({ diagnosisLadder: 'nonsense' }));
    mockGetMyPatientProfile.mockReset().mockResolvedValue({
      fullName: '张三',
      dateOfBirth: '1988-05-12',
      gender: '男',
      contactPhone: '13900000000',
      regionProvince: '上海市',
      regionCity: '上海市',
      regionDistrict: '浦东新区',
      baseline: { diseaseBackground: { diagnosisLadder: 'clinical_only' } },
    });
    const tree = await renderScreen();

    // The draft layers on top of the server value, so a bad draft would
    // otherwise win — and then be posted back. The key is dropped, not
    // blanked, so the stored answer survives.
    expect(pressable(tree, '临床诊断，还没做过基因检测').props.accessibilityState).toEqual({
      selected: true,
    });
    await save(tree);
    expect(savedBaseline().diseaseBackground.diagnosisLadder).toBe('clinical_only');
  });

  it('草稿里主动清空的那一格仍然赢过服务端 —— 取消是一个决定', async () => {
    mockGetSessionValue.mockResolvedValue(JSON.stringify({ diagnosisLadder: '', d4z4: '4' }));
    mockGetMyPatientProfile.mockReset().mockResolvedValue({
      fullName: '张三',
      dateOfBirth: '1988-05-12',
      gender: '男',
      contactPhone: '13900000000',
      regionProvince: '上海市',
      regionCity: '上海市',
      regionDistrict: '浦东新区',
      baseline: { diseaseBackground: { diagnosisLadder: 'clinical_only' } },
    });
    const tree = await renderScreen();

    expect(pressable(tree, '临床诊断，还没做过基因检测').props.accessibilityState).toEqual({
      selected: false,
    });
    await save(tree);
    expect(savedBaseline().diseaseBackground.diagnosisLadder).toBeNull();
  });
});

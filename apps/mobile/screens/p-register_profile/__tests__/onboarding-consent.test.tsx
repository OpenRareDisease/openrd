import TestRenderer, { act } from 'react-test-renderer';
import RegisterProfileScreen from '../index';

/**
 * PIPL Art. 29 on the registration form.
 *
 * The sensitive-data consent document is the gate in front of storing
 * diagnosis type, D4Z4 repeat count, haplotype and methylation, and
 * PUT /me/baseline is behind `requireSensitiveDataConsent` for exactly
 * that reason. Onboarding mode renders none of those fields — and it
 * still built a baseline out of nulls and sent it, which meant a
 * brand-new user had to accept the genetic-data document to store
 * nothing. Declining was not survivable either: the root layout keeps
 * sending a profile-less user back to this form, so「暂不同意」locked
 * them out of the app rather than opting them out of anything.
 *
 * So: ask when the payload actually carries health data, and skip the
 * write when it does not.
 */

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockReplace = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// The wheel pickers are irrelevant here and expensive to drive; each
// mock exposes one press that sets the value the form needs.
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
    // The screen instantiates the hook twice — Art. 31 guardian rules
    // first, then Art. 29 sensitive data — so the mock keys off which
    // document was asked for.
    ensureSensitiveDataConsent:
      document === 'guardian_consent' ? mockEnsureGuardianConsent : mockEnsureSensitiveDataConsent,
    gateProps: {},
  }),
}));

const mockUpsertPatientProfile = jest.fn().mockResolvedValue({});
const mockUpdateMyBaseline = jest.fn().mockResolvedValue({});
const mockGetMyPatientProfile = jest.fn();
jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    getMyPatientProfile: (...args: unknown[]) => mockGetMyPatientProfile(...args),
    upsertPatientProfile: (...args: unknown[]) => mockUpsertPatientProfile(...args),
    updateMyBaseline: (...args: unknown[]) => mockUpdateMyBaseline(...args),
  };
});

jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: () => Promise.resolve(null),
  setSessionValue: () => Promise.resolve(),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { phoneNumber: '13900000000', email: null } }),
}));

const mockRefreshProfileGate = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../contexts/ProfileContext', () => ({
  useProfileContext: () => ({ refresh: mockRefreshProfileGate }),
}));

jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ notify: jest.fn() }),
}));

const renderScreen = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<RegisterProfileScreen />);
  });
  return tree;
};

const byPlaceholder = (tree: TestRenderer.ReactTestRenderer, placeholder: string) =>
  tree.root.find((node) => node.props?.placeholder === placeholder);

const byAccessibilityLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) => node.props?.accessibilityLabel === label && typeof node.props?.onPress === 'function',
  )[0];

const pressSave = async (tree: TestRenderer.ReactTestRenderer) => {
  const save = tree.root.findAll(
    (node) =>
      node.props?.accessibilityLabel === '保存' && typeof node.props?.onPress === 'function',
  )[0];
  await act(async () => {
    save.props.onPress();
  });
};

/** Name + birth date + gender: everything onboarding mode asks for. */
const fillMinimalFields = async (tree: TestRenderer.ReactTestRenderer) => {
  await act(async () => {
    byPlaceholder(tree, '请输入姓名').props.onChangeText('张三');
  });
  await act(async () => {
    byAccessibilityLabel(tree, 'set-birth-date').props.onPress();
  });
  await act(async () => {
    byAccessibilityLabel(tree, '男').props.onPress();
  });
};

describe('p-register_profile — Art. 29 consent is asked about real data', () => {
  beforeEach(() => {
    mockParams = {};
    mockReplace.mockClear();
    mockEnsureGuardianConsent.mockClear().mockResolvedValue(true);
    mockEnsureSensitiveDataConsent.mockClear().mockResolvedValue(true);
    mockUpsertPatientProfile.mockClear().mockResolvedValue({});
    mockUpdateMyBaseline.mockClear().mockResolvedValue({});
    // Onboarding lands here precisely because there is no profile row.
    mockGetMyPatientProfile
      .mockReset()
      .mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));
  });

  it('does not ask for genetic-data consent during onboarding', async () => {
    mockParams = { mode: 'onboarding' };
    const tree = await renderScreen();
    await fillMinimalFields(tree);
    await pressSave(tree);

    expect(mockUpsertPatientProfile).toHaveBeenCalledTimes(1);
    expect(mockEnsureSensitiveDataConsent).not.toHaveBeenCalled();
  });

  it('does not send an all-null baseline during onboarding', async () => {
    mockParams = { mode: 'onboarding' };
    const tree = await renderScreen();
    await fillMinimalFields(tree);
    await pressSave(tree);

    expect(mockUpdateMyBaseline).not.toHaveBeenCalled();
    // The profile is still created, so the onboarding gate lets go.
    expect(mockRefreshProfileGate).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/p-home');
  });

  it('asks — and writes — as soon as a clinical field is filled in', async () => {
    const tree = await renderScreen();
    await fillMinimalFields(tree);
    await act(async () => {
      byPlaceholder(tree, '例如：FSHD1').props.onChangeText('FSHD1');
    });
    await act(async () => {
      byAccessibilityLabel(tree, 'set-region').props.onPress();
    });
    await pressSave(tree);

    expect(mockEnsureSensitiveDataConsent).toHaveBeenCalledTimes(1);
    expect(mockUpdateMyBaseline).toHaveBeenCalledTimes(1);
    expect(mockUpdateMyBaseline.mock.calls[0][0]).toMatchObject({
      diseaseBackground: { diagnosisType: 'FSHD1' },
    });
  });

  it('stores nothing when the patient declines on a payload that carries health data', async () => {
    mockEnsureSensitiveDataConsent.mockResolvedValue(false);
    const tree = await renderScreen();
    await fillMinimalFields(tree);
    await act(async () => {
      byPlaceholder(tree, '例如：FSHD1').props.onChangeText('FSHD1');
    });
    await act(async () => {
      byAccessibilityLabel(tree, 'set-region').props.onPress();
    });
    await pressSave(tree);

    expect(mockUpdateMyBaseline).not.toHaveBeenCalled();
    expect(mockUpsertPatientProfile).not.toHaveBeenCalled();
  });
});

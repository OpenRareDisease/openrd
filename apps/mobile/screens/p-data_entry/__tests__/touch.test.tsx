/**
 * 记录数据 under a hand that does not work well.
 *
 * Two things are pinned here.
 *
 * **Press feedback.** Every control on this screen was a bare
 * `TouchableOpacity`, i.e. react-native-web's default opacity fade and
 * nothing else. Under a thumb that is shaking and braced with the other
 * arm, an opacity change is invisible — the patient sees nothing move,
 * concludes the press missed, and presses again. On the screen that
 * writes to the medical record, that is the most credible mechanism
 * this product has for duplicate entries. Every touchable now goes
 * through `lib/press-scale`, whose spring is reanimated's, so
 * `prefers-reduced-motion` is honoured without this screen knowing
 * anything about it.
 *
 * **The 语音键 line.** The card's own argument is that typing is the
 * most expensive thing this screen asks for — and then it offers a
 * 500-character box. Chinese keyboards already carry a voice key; the
 * copy just has to say so, and has to say it as an *alternative*,
 * because FSHD weakens the face and speech is harder for some of these
 * patients rather than easier.
 */

import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    addActivityLog: jest.fn(),
    addDailyImpact: jest.fn(),
    addFunctionTest: jest.fn(),
    addFollowupEvent: jest.fn(),
    addPatientMeasurement: jest.fn(),
    addSymptomScore: jest.fn(),
    createSubmission: jest.fn(),
    draftLogEntry: jest.fn(),
    getMyPatientProfile: jest.fn().mockRejectedValue(new Error('no profile in this test')),
    isConsentRequiredError: () => false,
    uploadPatientDocumentsSerially: jest.fn(),
  };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn() }),
}));

jest.mock('../../common/ScreenHeader', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('ScreenHeader') };
});

jest.mock('../../p-privacy_settings/components/SensitiveDataConsentGate', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('SensitiveDataConsentGate'),
    useSensitiveDataConsentGate: () => ({
      ensureSensitiveDataConsent: jest.fn().mockResolvedValue(true),
      gateProps: {},
    }),
  };
});

// Imported after the mocks so the screen wires up against them.

import DataEntryScreen from '../index';

const mounted: TestRenderer.ReactTestRenderer[] = [];

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<DataEntryScreen />);
  });
  mounted.push(tree);
  return tree;
};

afterEach(() => {
  act(() => {
    while (mounted.length > 0) {
      mounted.pop()?.unmount();
    }
  });
});

/** Every pressable host in the tree — the nodes that actually receive
 *  a finger, as opposed to the wrapper components above them. */
const pressables = (tree: TestRenderer.ReactTestRenderer): ReactTestInstance[] =>
  tree.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' && typeof node.props?.onPressIn === 'function',
    { deep: false },
  );

/** See Button.test.tsx: the animated value cannot be read under jest
 *  (the spring runs on the UI thread), but the *shape* proves the
 *  feedback is a reanimated scale rather than a hand-rolled timer —
 *  which is what makes `prefers-reduced-motion` work. */
const hasReanimatedScaleStyle = (style: unknown): boolean =>
  (Array.isArray(style) ? style : [style]).some((entry) => {
    const initial = (
      entry as { initial?: { value?: { transform?: Array<{ scale?: number }> } } } | null
    )?.initial?.value;
    return Boolean(initial?.transform?.some((transform) => typeof transform.scale === 'number'));
  });

const allText = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => allText(child as ReactTestInstance | string | null)).join('');
};

describe('记录数据 press feedback', () => {
  it('gives every touchable a reanimated press response', async () => {
    const tree = await render();
    const controls = pressables(tree);

    // The four mode rows plus the followup form's chips, buckets and
    // steppers are all on screen at mount, so this is not a trivial
    // sample.
    expect(controls.length).toBeGreaterThanOrEqual(10);
    for (const control of controls) {
      expect(hasReanimatedScaleStyle(control.props.style)).toBe(true);
    }
  });

  it('covers 肌力自测 too, which lives in its own file', async () => {
    // MuscleSelfTestForm renders as one of this screen's four modes, so
    // it is easy to migrate the parent and leave the child on the old
    // opacity-only behaviour — visibly a different app one tap away.
    const tree = await render();
    const muscleRow = tree.root
      .findAll((node) => typeof node.props?.onPressIn === 'function', { deep: false })
      .find((node) => allText(node).includes('肌力自测'));
    act(() => {
      muscleRow!.props.onPress();
    });

    const controls = pressables(tree);
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const control of controls) {
      expect(hasReanimatedScaleStyle(control.props.style)).toBe(true);
    }
  });

  it('still routes the press to whatever the control already did', async () => {
    // Feedback only: pressing 事件记录 must still switch modes. The
    // wrapper composes handlers rather than replacing them, and this is
    // the assertion that would catch it swallowing `onPress`.
    const tree = await render();
    const eventRow = tree.root
      .findAll((node) => typeof node.props?.onPressIn === 'function', { deep: false })
      .find((node) => allText(node).includes('事件记录'));
    expect(eventRow).toBeDefined();

    act(() => {
      eventRow!.props.onPressIn();
      eventRow!.props.onPress();
      eventRow!.props.onPressOut();
    });

    expect(allText(tree.root)).toContain('事件与干预记录');
  });
});

describe('说一句话就行', () => {
  it('tells the patient their own keyboard has a voice key', async () => {
    const text = allText((await render()).root);
    expect(text).toContain('语音键');
    // Named vendors, because「用语音输入」is advice and「搜狗/讯飞/
    // 微信键盘/iOS 听写 上都有」is a place to look.
    expect(text).toContain('搜狗');
    expect(text).toContain('听写');
  });

  it('keeps typing an equal path rather than the fallback nobody mentions', async () => {
    // FSHD's facial weakness affects articulation, so speech is not a
    // universal upgrade here. If this line ever becomes「说出来就行」
    // with no alternative, this goes red.
    expect(allText((await render()).root)).toContain('直接打字');
  });
});

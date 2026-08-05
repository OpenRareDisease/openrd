/**
 * 登录 / 注册 under a hand that does not work well.
 *
 * This is the one screen every patient has to get through, and three
 * of its defects were specifically about hands:
 *
 *  1. 忘记密码？, 《用户协议》 and 《隐私政策》 drew 34pt tall against
 *     this repo's own MIN_TOUCH_TARGET of 48. They were `compact`
 *     buttons, and `compact` pairs 34pt with a `hitSlop` that
 *     react-native-web 0.20 does not implement for Pressable or
 *     TouchableOpacity — so on the platform this product actually
 *     ships, the slop bought nothing.
 *
 *  2. 获取验证码 had no in-flight state. The countdown only starts once
 *     the gateway has answered, so a second press during the round trip
 *     sent a second REAL text message, burned a quota slot, and moved
 *     `requestId` — leaving the patient holding a code the server now
 *     calls 已过期.
 *
 *  3. Nothing on the screen set `autoComplete`, so the six-digit OTP
 *     round trip (leave browser → read SMS → memorise → come back →
 *     type) could not be shortened by the platform.
 */

import { StyleSheet } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../../lib/validation';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    login: jest.fn(),
    loginWithOtp: jest.fn(),
    recordLegalAcceptance: jest.fn(),
    register: jest.fn(),
    resetPassword: jest.fn(),
    sendOtp: jest.fn(),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ setSession: jest.fn() }),
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

jest.mock('../../common/ScreenBackButton', () => {
  const React = require('react');
  return { __esModule: true, default: () => React.createElement('ScreenBackButton') };
});

// Imported after the mocks so the screen wires up against them.

import LoginRegisterScreen from '../index';
import { sendOtp } from '../../../lib/api';

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

/** Every tree this file mounts, so `afterEach` can unmount them. The
 *  resend countdown is a real `setInterval`; leaving one running keeps
 *  jest's worker alive after the suite finishes. */
const mounted: TestRenderer.ReactTestRenderer[] = [];

/** Async so the register-draft hydration effect (which awaits session
 *  storage) settles inside `act` instead of warning afterwards. */
const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LoginRegisterScreen />);
  });
  mounted.push(tree);
  return tree;
};

/**
 * The pressable host carrying this spoken name.
 *
 * `onPressIn` rather than `onPress` is the discriminator on purpose:
 * both `Button` and `PressableScale` are wrappers that receive
 * `accessibilityLabel` + `onPress` from their caller, so matching on
 * those two finds the wrapper on some call sites and the real
 * pressable on others. Only the pressable itself carries `onPressIn`.
 */
const controlNamed = (tree: TestRenderer.ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root.findAll(
    (node) =>
      node.props?.accessibilityLabel === label && typeof node.props?.onPressIn === 'function',
    { deep: false },
  )[0];

const inputWithPlaceholder = (
  tree: TestRenderer.ReactTestRenderer,
  placeholder: string,
): ReactTestInstance =>
  tree.root.findAll(
    (node) =>
      node.props?.placeholder === placeholder && typeof node.props?.onChangeText === 'function',
    { deep: false },
  )[0];

const drawnHeight = (node: ReactTestInstance): number => {
  const flattened = StyleSheet.flatten(node.props.style as never) as {
    minHeight?: number;
    height?: number;
  };
  return flattened.height ?? flattened.minHeight ?? 0;
};

/** See Button.test.tsx — proves the press feedback is reanimated's, so
 *  `prefers-reduced-motion` is honoured for free. */
const hasReanimatedScaleStyle = (style: unknown): boolean =>
  (Array.isArray(style) ? style : [style]).some((entry) => {
    const initial = (
      entry as { initial?: { value?: { transform?: Array<{ scale?: number }> } } } | null
    )?.initial?.value;
    return Boolean(initial?.transform?.some((transform) => typeof transform.scale === 'number'));
  });

/** Walk into the 重置密码 flow, which is where the second OTP call site
 *  lives and where a code field and two new-password fields are all
 *  reachable without touching the segmented control. */
const openResetFlow = (tree: TestRenderer.ReactTestRenderer) => {
  act(() => {
    controlNamed(tree, '忘记密码？').props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  act(() => {
    while (mounted.length > 0) {
      mounted.pop()?.unmount();
    }
  });
});

describe('登录/注册 touch targets', () => {
  it.each(['忘记密码？', '《用户协议》', '《隐私政策》'])(
    '%s is at least MIN_TOUCH_TARGET tall as drawn, not only via hitSlop',
    async (label) => {
      // 34 before this change. hitSlop cannot rescue it: grep
      // react-native-web 0.20 for `hitSlop` and it appears only in the
      // legacy Touchable mixin, which neither Pressable nor
      // TouchableOpacity uses.
      expect(drawnHeight(controlNamed(await render(), label))).toBeGreaterThanOrEqual(
        MIN_TOUCH_TARGET,
      );
    },
  );

  it('keeps 返回登录 full size inside the reset flow too', async () => {
    const tree = await render();
    openResetFlow(tree);
    expect(drawnHeight(controlNamed(tree, '返回登录'))).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

describe('获取验证码 in-flight state', () => {
  it('sends exactly one SMS when the button is pressed twice in one tick', async () => {
    // The shaking-hand case: two press events milliseconds apart, both
    // before React has re-rendered. A `busy` prop alone does not cover
    // it — only the synchronous ref guard does.
    let resolveSend: (value: unknown) => void = () => {};
    asMock(sendOtp).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const tree = await render();
    openResetFlow(tree);

    act(() => {
      inputWithPlaceholder(tree, '请输入注册时的手机号').props.onChangeText('13800138000');
    });

    act(() => {
      controlNamed(tree, '获取短信验证码').props.onPress();
      controlNamed(tree, '获取短信验证码').props.onPress();
    });

    expect(asMock(sendOtp)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend({ requestId: 'req-1', retryAfterSeconds: 60 });
    });
  });

  it('announces itself as busy while the gateway is answering', async () => {
    let resolveSend: (value: unknown) => void = () => {};
    asMock(sendOtp).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const tree = await render();
    openResetFlow(tree);

    act(() => {
      inputWithPlaceholder(tree, '请输入注册时的手机号').props.onChangeText('13800138000');
    });
    act(() => {
      controlNamed(tree, '获取短信验证码').props.onPress();
    });

    // Both spellings, same as everywhere else in this app: RNW 0.20
    // drops accessibilityState, native ignores aria-*.
    const button = controlNamed(tree, '获取短信验证码');
    expect(button.props['aria-busy']).toBe(true);
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });

    await act(async () => {
      resolveSend({ requestId: 'req-1', retryAfterSeconds: 60 });
    });
  });

  it('never fires a request while one is already in the air', async () => {
    let resolveSend: (value: unknown) => void = () => {};
    asMock(sendOtp).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );

    const tree = await render();
    openResetFlow(tree);
    act(() => {
      inputWithPlaceholder(tree, '请输入注册时的手机号').props.onChangeText('13800138000');
    });
    act(() => {
      controlNamed(tree, '获取短信验证码').props.onPress();
    });
    // A press that arrives after a re-render — the button is disabled
    // by then, but call it directly to prove the guard, not the prop,
    // is what refuses.
    act(() => {
      controlNamed(tree, '获取短信验证码').props.onPress();
    });
    expect(asMock(sendOtp)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend({ requestId: 'req-1', retryAfterSeconds: 60 });
    });
  });
});

describe('autofill hints', () => {
  it('marks the phone fields as telephone numbers', async () => {
    const phone = inputWithPlaceholder(await render(), '请输入手机号');
    expect(phone.props.autoComplete).toBe('tel');
    expect(phone.props.inputMode).toBe('tel');
    expect(phone.props.textContentType).toBe('telephoneNumber');
  });

  it('marks the login password as the saved one, not a new one', async () => {
    const password = inputWithPlaceholder(await render(), '请输入密码');
    expect(password.props.autoComplete).toBe('current-password');
    expect(password.props.textContentType).toBe('password');
  });

  it('marks the OTP field as a one-time code', async () => {
    // The point of the whole exercise: in iOS WKWebView (what WeChat
    // embeds on iOS) this collapses the SMS round trip to one tap.
    // Android WeChat's X5 coverage is partial — this does not claim
    // otherwise, it just costs nothing there.
    const tree = await render();
    openResetFlow(tree);
    const code = inputWithPlaceholder(tree, '请输入验证码');
    expect(code.props.autoComplete).toBe('one-time-code');
    expect(code.props.inputMode).toBe('numeric');
    expect(code.props.textContentType).toBe('oneTimeCode');
  });

  it('stops a password manager offering the old password as the new one', async () => {
    const tree = await render();
    openResetFlow(tree);
    for (const placeholder of [
      `请设置${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位新密码`,
      '请再次输入新密码',
    ]) {
      const field = inputWithPlaceholder(tree, placeholder);
      expect(field?.props.autoComplete).toBe('new-password');
      expect(field?.props.textContentType).toBe('newPassword');
    }
  });
});

describe('press feedback', () => {
  it('moves the password-visibility toggle under a finger', async () => {
    // It was a bare TouchableOpacity: react-native-web's default
    // opacity fade and nothing else. Under a thumb, that is invisible.
    const toggle = controlNamed(await render(), '显示密码');
    expect(typeof toggle.props.onPressIn).toBe('function');
    expect(hasReanimatedScaleStyle(toggle.props.style)).toBe(true);
  });
});

import { COLOR } from '../../lib/design';
import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type LayoutChangeEvent,
} from 'react-native';
import PressableScale from '../../lib/press-scale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Icon from '../common/Icon';
import Button from '../common/Button';
import SegmentedControl from '../common/SegmentedControl';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import styles from './styles';
import {
  ApiError,
  login,
  loginWithOtp,
  recordLegalAcceptance,
  register,
  resetPassword,
  sendOtp,
} from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

import { getSessionValue, setSessionValue } from '../../lib/session-storage';
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_VERSIONS,
  PRIVACY_POLICY_TEXT,
  PRIVACY_POLICY_TITLE,
  USER_AGREEMENT_TEXT,
  USER_AGREEMENT_TITLE,
} from '../../lib/legal-content';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type LoginErrors,
  type LoginField,
  type RegisterErrors,
  type RegisterField,
  firstRegisterError,
  isValidChinaMobile,
  isValidPassword,
  validateLoginForm,
  validateRegisterForm,
} from '../../lib/validation';
import ScreenBackButton from '../common/ScreenBackButton';
import { REGISTER_FORM_DRAFT_KEY, REGISTER_FORM_DRAFT_MAX_AGE_MS } from '../../lib/draft-keys';
import { parseRegisterDraft } from '../../lib/register-draft';

/**
 * Autofill hints for the four kinds of field on this screen.
 *
 * Why they are worth the four constants
 * -------------------------------------
 * Nothing in this app set `autoComplete`, `textContentType` or
 * `inputMode` anywhere — the 12 inputs below only set `keyboardType`.
 * react-native-web then falls back to `autoComplete="on"`, which tells
 * a browser to offer *something* and nothing about what.
 *
 * The OTP round trip is the single most expensive interaction this
 * product asks of an FSHD patient: leave the browser, open 信息, hold
 * six digits in your head, come back, and type them into a field
 * before they expire — with hands that lose grip and aim. It is also
 * the only step here that a platform can do for you.
 *
 * What each of these actually buys, honestly
 * ------------------------------------------
 *  - `one-time-code` is the standard HTML token for SMS autofill. In
 *    iOS WKWebView — which is what WeChat embeds on iOS, and a large
 *    share of these patients — it turns the whole trip into one tap on
 *    a QuickType suggestion.
 *  - On Android the picture is partial and we should not pretend
 *    otherwise: WeChat renders in Tencent's X5 shell, whose support
 *    for OTP autofill varies by X5 build and by keyboard, and Chinese
 *    OEM SMS-reading is a per-vendor feature rather than a web one.
 *    `sms-otp` is the Android-flavoured RN token, but RN maps
 *    `autoComplete` straight through to the DOM attribute on web, so
 *    only one string can be sent — `one-time-code` is the one that is
 *    a real standard. Android users who get nothing are exactly where
 *    they already were; nobody is worse off.
 *  - `tel` / `current-password` / `new-password` are ordinary,
 *    long-standing tokens: they let a password manager fill the login
 *    and stop it offering the saved password as the *new* one during
 *    registration and reset.
 *
 * `textContentType` is the iOS-native spelling of the same intent (a
 * no-op on web, where RNW drops it); `inputMode` sets the on-screen
 * keyboard on web the way `keyboardType` does on device. All three are
 * kept because this codebase runs in all three places.
 */
const PHONE_FIELD_PROPS = {
  keyboardType: 'phone-pad',
  inputMode: 'tel',
  autoComplete: 'tel',
  textContentType: 'telephoneNumber',
} as const;

const OTP_FIELD_PROPS = {
  keyboardType: 'number-pad',
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  textContentType: 'oneTimeCode',
} as const;

const CURRENT_PASSWORD_FIELD_PROPS = {
  autoComplete: 'current-password',
  textContentType: 'password',
} as const;

const NEW_PASSWORD_FIELD_PROPS = {
  autoComplete: 'new-password',
  textContentType: 'newPassword',
} as const;

interface LoginFormData {
  phone: string;
  password: string;
}

interface RegisterFormData {
  phone: string;
  code: string;
  otpRequestId?: string;
  password: string;
  confirmPassword: string;
  identity: 'doctor' | 'patient_family' | 'other';
}

interface ModalState {
  isVisible: boolean;
  title: string;
  message: string;
  type: 'error' | 'success' | 'agreement';
  content?: string;
}

const LoginRegisterScreen: React.FC = () => {
  const router = useRouter();
  const { setSession } = useAuth();

  // 表单状态
  const [activeTab, setActiveTab] = useState<'login' | 'register'>('login');
  const [loginForm, setLoginForm] = useState<LoginFormData>({
    phone: '',
    password: '',
  });
  // Password vs OTP login, plus the self-service reset flow. OTP
  // login only needs two fields — the lowest-effort path for users
  // with limited fine motor control (and the only path when the
  // password is forgotten).
  const [loginMethod, setLoginMethod] = useState<'password' | 'otp'>('password');
  const [isResetMode, setIsResetMode] = useState(false);
  const [otpLoginForm, setOtpLoginForm] = useState({
    phone: '',
    code: '',
    requestId: undefined as string | undefined,
  });
  const [otpLoginErrors, setOtpLoginErrors] = useState<Record<string, string>>({});
  const [resetForm, setResetForm] = useState({
    phone: '',
    code: '',
    requestId: undefined as string | undefined,
    newPassword: '',
    confirmPassword: '',
  });
  const [resetErrors, setResetErrors] = useState<Record<string, string>>({});
  const [registerForm, setRegisterForm] = useState<RegisterFormData>({
    phone: '',
    code: '',
    otpRequestId: undefined,
    password: '',
    confirmPassword: '',
    identity: 'patient_family',
  });
  const [isRegisterDraftHydrated, setIsRegisterDraftHydrated] = useState(false);

  /**
   * 用户协议 + 隐私政策 acceptance. Un-prechecked, and deliberately NOT
   * part of `registerForm`: the draft persist effect below writes
   * everything in that object to storage, so folding the flag in would
   * mean an interrupted registration comes back with the box already
   * ticked — i.e. the app would be asserting a consent the user never
   * gave on this attempt. 《个人信息保护法》第 14 条 requires consent to
   * be 「自愿、明确作出」; a restored tick is neither.
   */
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  /**
   * When the number in the draft was FIRST typed, not when it was last
   * written. The expiry below has to be anchored to something the user
   * did; if each persist stamped `Date.now()` the hydrate effect would
   * re-stamp it on mount, and merely opening the 注册 tab once a day
   * would keep someone else's phone number alive for ever — which is
   * the exact failure the bound exists to close.
   */
  const registerDraftSavedAtRef = useRef<number | null>(null);

  // Restore an interrupted registration (user switched away to read
  // the SMS, app got killed, …). Secrets and OTP state are NEVER
  // persisted — see the persist effect below.
  useEffect(() => {
    (async () => {
      try {
        const raw = await getSessionValue(REGISTER_FORM_DRAFT_KEY);
        // Expiry, the pre-bound (no savedAt) shape and the pre-slim
        // shape are all decided in lib/register-draft.ts, where they
        // are covered by tests. A null here always means「delete」, not
        // 「keep it and look again later」: a draft we refuse to restore
        // is a phone number with no owner, and leaving it on disk is
        // the whole defect.
        const draft = parseRegisterDraft(raw, {
          now: Date.now(),
          maxAgeMs: REGISTER_FORM_DRAFT_MAX_AGE_MS,
        });
        if (!draft) {
          if (raw) {
            await setSessionValue(REGISTER_FORM_DRAFT_KEY, null);
          }
        } else {
          registerDraftSavedAtRef.current = draft.savedAt;
          setRegisterForm((prev) => ({
            ...prev,
            phone: draft.phone,
            identity: draft.identity ?? prev.identity,
          }));
        }
      } catch {
        // A broken draft must never block registration.
      } finally {
        setIsRegisterDraftHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isRegisterDraftHydrated) {
      return;
    }
    // Strip everything secret-shaped before persisting: passwords
    // must not land in storage, and a stale OTP code/requestId would
    // just fail verification later anyway.
    const { password, confirmPassword, code, otpRequestId, ...safeDraft } = registerForm;
    void password;
    void confirmPassword;
    void code;
    void otpRequestId;

    // Nothing to restore means nothing to store. Without this the
    // effect fired once on mount with an empty form and planted the
    // key on every device that merely *opened* the 注册 tab; and a
    // patient who deliberately cleared the number would have watched
    // the cleared value be written straight back. `identity` alone is
    // a three-value enum, not worth a storage entry on its own.
    if (!safeDraft.phone.trim()) {
      registerDraftSavedAtRef.current = null;
      setSessionValue(REGISTER_FORM_DRAFT_KEY, null).catch(() => {});
      return;
    }

    // Carried forward, never re-stamped — see registerDraftSavedAtRef.
    const savedAt = registerDraftSavedAtRef.current ?? Date.now();
    registerDraftSavedAtRef.current = savedAt;

    setSessionValue(REGISTER_FORM_DRAFT_KEY, JSON.stringify({ ...safeDraft, savedAt })).catch(
      () => {
        // Draft persistence must never block typing.
      },
    );
  }, [registerForm, isRegisterDraftHydrated]);

  // UI状态
  const [isLoginPasswordVisible, setIsLoginPasswordVisible] = useState(false);
  const [isRegisterPasswordVisible, setIsRegisterPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  /**
   * A 获取验证码 request is in the air.
   *
   * The countdown alone did not cover this: it only starts once the
   * gateway has *answered*, so the whole round trip — a second or two
   * on a phone network, longer on a bad one — left the button live and
   * looking untouched. Press it again there and the second request is
   * a second REAL text message: it costs money, it burns one of the
   * day's per-number quota slots, and (worst of the three) it moves
   * `requestId`, so the code the patient is reading off their lock
   * screen now belongs to a superseded request and comes back
   * 「已过期」. That is a dead end reached by doing nothing wrong.
   *
   * One flag for all three flows because only one of them is ever on
   * screen — register, OTP login and reset never share a moment.
   */
  const [isSendingCode, setIsSendingCode] = useState(false);
  /**
   * The same fact, readable synchronously.
   *
   * `busy`/`disabled` only stop the second press after React has
   * re-rendered, and the press this exists for lands before that: a
   * hand that shakes produces two events milliseconds apart, both
   * inside the same tick. State would still be `false` for the second
   * one. The ref is what actually makes the second SMS impossible.
   */
  const isSendingCodeRef = useRef(false);
  const [modalState, setModalState] = useState<ModalState>({
    isVisible: false,
    title: '',
    message: '',
    type: 'error',
  });

  // Inline form errors. `liveXxxErrors` recomputes against the current
  // values on every render (cheap pure functions); `xxxErrors` marks the
  // fields "armed" by a submit attempt. A message renders only while a
  // field is both armed AND still failing, so fixing the input clears
  // its error without per-field onChange bookkeeping.
  const [loginErrors, setLoginErrors] = useState<LoginErrors>({});
  const [registerErrors, setRegisterErrors] = useState<RegisterErrors>({});

  // 动画值
  const logoTranslateY = useSharedValue(0);

  // refs
  // `setInterval` in React Native returns NodeJS's `Timeout`, not the
  // browser DOM's `number`. Using `ReturnType<typeof setInterval>`
  // keeps tsc happy in both environments without committing to either
  // (which would break the other platform's lib types).
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollViewRef = useRef<ScrollView>(null);
  // Y offsets for scroll-to-first-error. Each onLayout `y` is relative
  // to the immediate parent, so a field's absolute scroll position is
  // mainContent.y + formContainer.y + field.y.
  const sectionYRef = useRef({ main: 0, form: 0 });
  const registerFieldYRef = useRef<Partial<Record<RegisterField, number>>>({});

  const liveLoginErrors = useMemo(() => validateLoginForm(loginForm), [loginForm]);
  const liveRegisterErrors = useMemo(() => validateRegisterForm(registerForm), [registerForm]);

  const visibleLoginError = (field: LoginField) =>
    loginErrors[field] ? liveLoginErrors[field] : undefined;
  const visibleRegisterError = (field: RegisterField) =>
    registerErrors[field] ? liveRegisterErrors[field] : undefined;

  const renderLoginError = (field: LoginField) => {
    const message = visibleLoginError(field);
    return message ? <Text style={styles.fieldErrorText}>{message}</Text> : null;
  };
  const renderRegisterError = (field: RegisterField) => {
    const message = visibleRegisterError(field);
    return message ? <Text style={styles.fieldErrorText}>{message}</Text> : null;
  };

  const captureRegisterFieldY = (field: RegisterField) => (event: LayoutChangeEvent) => {
    registerFieldYRef.current[field] = event.nativeEvent.layout.y;
  };

  const scrollToRegisterField = (field: RegisterField | null) => {
    if (!field) {
      return;
    }
    const fieldY = registerFieldYRef.current[field] ?? 0;
    const y = sectionYRef.current.main + sectionYRef.current.form + fieldY;
    scrollViewRef.current?.scrollTo({ y: Math.max(y - 12, 0), animated: true });
  };

  // 启动logo浮动动画
  //
  // `logoTranslateY` is omitted on purpose. `useSharedValue` hands back
  // the same reference for the life of the component, so there is no
  // render at which this effect could see a different one — the stale
  // closure the rule is warning about cannot exist here. The animation
  // is also meant to start once and repeat forever (`withRepeat(..., -1)`),
  // so re-running the effect would restart the cycle mid-float.
  React.useEffect(() => {
    logoTranslateY.value = withRepeat(
      withTiming(-10, {
        duration: 3000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, []);

  // logo动画样式
  const logoAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: logoTranslateY.value }],
    };
  });

  const formatPhoneNumber = (phone: string) => {
    if (!phone) {
      return '';
    }
    const trimmed = phone.trim();
    if (trimmed.startsWith('+')) {
      return trimmed;
    }
    return `+86${trimmed}`;
  };

  // 显示弹窗
  const showModal = (
    type: 'error' | 'success' | 'agreement',
    title: string,
    message: string,
    content?: string,
  ) => {
    setModalState({
      isVisible: true,
      title,
      message,
      type,
      content,
    });
  };

  // 关闭弹窗
  const closeModal = () => {
    setModalState((prev) => ({ ...prev, isVisible: false }));
  };

  // 标签切换
  const handleTabSwitch = (tab: 'login' | 'register') => {
    setActiveTab(tab);
    if (tab === 'login') {
      // Switching to 登录 is the clearest「I am not registering after
      // all」signal this screen ever gets, and it is the abandonment
      // path that never reaches logout — the device has no session, so
      // PATIENT_SCOPED_SECURE_KEYS is never swept. Drop the number now
      // rather than leaving it to the 24h expiry.
      void setSessionValue(REGISTER_FORM_DRAFT_KEY, null).catch(() => {});
    }
  };

  // 密码显示切换
  const togglePasswordVisibility = (type: 'login' | 'register' | 'confirm') => {
    switch (type) {
      case 'login':
        setIsLoginPasswordVisible(!isLoginPasswordVisible);
        break;
      case 'register':
        setIsRegisterPasswordVisible(!isRegisterPasswordVisible);
        break;
      case 'confirm':
        setIsConfirmPasswordVisible(!isConfirmPasswordVisible);
        break;
    }
  };

  // 获取验证码
  /** (Re)start the resend countdown. Clears any interval already
   *  running so a 429-driven restart can't stack two tickers. */
  const startCountdown = (seconds: number) => {
    if (countdownInterval.current) {
      clearInterval(countdownInterval.current);
      countdownInterval.current = null;
    }
    setCountdown(seconds);
    countdownInterval.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownInterval.current) {
            clearInterval(countdownInterval.current);
            countdownInterval.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /** The server's 429 payload carries the authoritative seconds left
   *  (`details.waitSeconds`, otp.service enforces the interval). */
  const extractWaitSeconds = (error: unknown): number | null => {
    if (!(error instanceof ApiError) || error.status !== 429) return null;
    const details = (error.data as { details?: { waitSeconds?: unknown } } | null)?.details;
    const waitSeconds = details?.waitSeconds;
    return typeof waitSeconds === 'number' && waitSeconds > 0 ? Math.ceil(waitSeconds) : null;
  };

  const handleGetVerificationCode = async () => {
    // Only arm the phone field — the user may not have touched the
    // rest of the form yet, so a full-form error sweep here would
    // paint every empty field red. The button sits next to the phone
    // input, so no scroll is needed.
    if (liveRegisterErrors.phone) {
      setRegisterErrors((prev) => ({ ...prev, phone: liveRegisterErrors.phone }));
      return;
    }

    await requestOtpCode('register', registerForm.phone, (requestId) =>
      setRegisterForm((prev) => ({ ...prev, otpRequestId: requestId })),
    );
  };

  // 登录提交
  const handleLoginSubmit = async () => {
    if (Object.keys(liveLoginErrors).length > 0) {
      setLoginErrors(liveLoginErrors);
      return;
    }
    setLoginErrors({});

    setIsLoading(true);

    try {
      const response = await login({
        phoneNumber: formatPhoneNumber(loginForm.phone),
        password: loginForm.password,
      });

      await setSession(response);
      // Somebody logged in on this device, so whoever was half-way
      // through 注册 is not coming back to it. This is the second
      // abandonment point (the first is handleTabSwitch); together
      // with the 24h bound they cover the paths that never reach
      // logout, which is the only sweep that knows about the key.
      await setSessionValue(REGISTER_FORM_DRAFT_KEY, null).catch(() => {});
      // Show only the last 4 digits — the full phone number on a
      // shoulder-surfable success toast is a "we're showing PII we
      // don't need to" case the strict review flagged.
      const lastFour = (response.user.phoneNumber ?? '').slice(-4) || '****';
      showModal('success', '登录成功', `欢迎回来，尾号 ${lastFour}`);
      router.replace('/p-home');
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 401 ? '用户名或密码错误' : '登录失败，请重试';
      showModal('error', '错误', message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Persist「这个用户在这一天同意了这一版」 to the acceptance ledger
   * (db/migrations/019). Called once, right after the token exists —
   * the endpoint is authenticated, and an anonymous write into a table
   * keyed by user id would defeat the point of having the ledger.
   *
   * Failures are logged and swallowed. The account has already been
   * created and the session already stored by the time we get here, so
   * throwing would strand the user on the register screen with a
   * working account they cannot see. The ledger is not left broken for
   * ever either: GET /legal/acceptances returns `outstanding`, and the
   * sensitive-PI gate re-asks before any health data is stored, so a
   * lost write costs a re-confirmation rather than a silent gap.
   *
   * Both documents are recorded, not one combined「agreement」row: the
   * two texts version independently, and a future revision of only the
   * privacy policy has to be able to re-ask for only that one.
   */
  const recordRegistrationAcceptances = async () => {
    const documents = [LEGAL_DOCUMENTS.userAgreement, LEGAL_DOCUMENTS.privacyPolicy] as const;
    const results = await Promise.allSettled(
      // lib/api's recordLegalAcceptance, not a hand-rolled POST: the
      // consent ledger is PIPL evidence, and it should have exactly one
      // writer so the request shape cannot drift per call site.
      documents.map((document) =>
        recordLegalAcceptance(document, LEGAL_DOCUMENT_VERSIONS[document]),
      ),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('[legal] failed to record agreement acceptance', result.reason);
      }
    }
  };

  // 注册提交
  const handleRegisterSubmit = async () => {
    // Surface EVERY failing field inline at once (no more one
    // blocking modal per issue), and bring the first one into view.
    if (Object.keys(liveRegisterErrors).length > 0) {
      setRegisterErrors(liveRegisterErrors);
      scrollToRegisterField(firstRegisterError(liveRegisterErrors));
      return;
    }
    setRegisterErrors({});

    // The consent gate. Checked AFTER the field errors so a user who
    // has both problems sees the fields first (they are above the
    // checkbox on screen) — but before the network call, because a
    // registration completed without acceptance is an account we then
    // have no lawful basis to hold data for.
    if (!hasAcceptedTerms) {
      setTermsError('请先阅读并勾选同意《用户协议》和《隐私政策》');
      scrollViewRef.current?.scrollToEnd({ animated: true });
      return;
    }
    setTermsError(null);

    setIsLoading(true);

    try {
      // The public register endpoint only accepts patient/caregiver —
      // clinician accounts are provisioned through a back-office path
      // with licence verification (auth.schema.ts). Mapping doctor →
      // 'clinician' made every doctor-identity registration fail zod
      // with an opaque 400; doctors sign up as caregiver-tier accounts
      // until clinician provisioning exists.
      const roleMap = {
        doctor: 'caregiver',
        patient_family: 'patient',
        other: 'caregiver',
      } as const;
      const response = await register({
        phoneNumber: formatPhoneNumber(registerForm.phone),
        otpCode: registerForm.code.trim(),
        otpRequestId: registerForm.otpRequestId,
        password: registerForm.password,
        role: roleMap[registerForm.identity],
      });

      // Account only — the medical profile is created behind the
      // onboarding gate (app/_layout), which intercepts the /p-home
      // navigation below and walks the user through the minimal
      // 3-field setup. The old inline profile+baseline chain here
      // could half-fail AFTER the token was stored, stranding an
      // account with no profile and no recovery path.
      await setSession(response);
      // Ledger write goes here and not before setSession: apiRequest
      // reads the token out of storage, and setSession is what puts it
      // there.
      await recordRegistrationAcceptances();
      // Registration is complete — the draft has served its purpose.
      await setSessionValue(REGISTER_FORM_DRAFT_KEY, null);
      showModal('success', '注册成功', '接下来用 1 分钟完成基础档案');
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '注册失败，请重试';
      showModal('error', '错误', message);
    } finally {
      setIsLoading(false);
    }
  };

  /** Shared send-code path for ALL three OTP flows (register/login/reset):
   *  one countdown + 429 implementation, parameterized by scene. */
  const requestOtpCode = async (
    scene: 'register' | 'login' | 'reset',
    phone: string,
    onRequestId: (requestId: string) => void,
  ): Promise<boolean> => {
    // See isSendingCodeRef: the duplicate press this drops is the one
    // that would have sent a second real SMS and invalidated the code
    // the patient is already holding.
    if (isSendingCodeRef.current) {
      return false;
    }
    isSendingCodeRef.current = true;
    setIsSendingCode(true);

    try {
      const response = await sendOtp({
        phoneNumber: formatPhoneNumber(phone),
        scene,
      });
      onRequestId(response.requestId);
      startCountdown(response.retryAfterSeconds ?? 60);
      const message =
        __DEV__ && response.mockCode
          ? `验证码已发送（测试码：${response.mockCode}）`
          : '验证码已发送';
      showModal('success', '成功', message);
      return true;
    } catch (error) {
      const waitSeconds = extractWaitSeconds(error);
      if (waitSeconds !== null) {
        startCountdown(waitSeconds);
        showModal('error', '发送过于频繁', `请在 ${waitSeconds} 秒后再试。`);
        return false;
      }
      const message = error instanceof ApiError ? error.message : '验证码发送失败，请稍后重试';
      showModal('error', '错误', message);
      return false;
    } finally {
      isSendingCodeRef.current = false;
      setIsSendingCode(false);
    }
  };

  const handleOtpLoginSubmit = async () => {
    const errors: Record<string, string> = {};
    if (!isValidChinaMobile(otpLoginForm.phone)) {
      errors.phone = otpLoginForm.phone ? '请输入正确的手机号' : '请输入手机号';
    }
    if (!otpLoginForm.code.trim()) {
      errors.code = '请输入验证码';
    }
    setOtpLoginErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await loginWithOtp({
        phoneNumber: formatPhoneNumber(otpLoginForm.phone),
        code: otpLoginForm.code.trim(),
        requestId: otpLoginForm.requestId,
      });
      await setSession(response);
      // Same reasoning as the password-login path above.
      await setSessionValue(REGISTER_FORM_DRAFT_KEY, null).catch(() => {});
      const lastFour = (response.user.phoneNumber ?? '').slice(-4) || '****';
      showModal('success', '登录成功', `欢迎回来，尾号 ${lastFour}`);
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '登录失败，请重试';
      showModal('error', '错误', message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordResetSubmit = async () => {
    const errors: Record<string, string> = {};
    if (!isValidChinaMobile(resetForm.phone)) {
      errors.phone = resetForm.phone ? '请输入正确的手机号' : '请输入手机号';
    }
    if (!resetForm.code.trim()) {
      errors.code = '请输入验证码';
    }
    if (!isValidPassword(resetForm.newPassword)) {
      errors.newPassword = `密码长度应为${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位`;
    }
    if (resetForm.newPassword !== resetForm.confirmPassword) {
      errors.confirmPassword = '两次输入的密码不一致';
    }
    setResetErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    setIsLoading(true);
    try {
      await resetPassword({
        phoneNumber: formatPhoneNumber(resetForm.phone),
        code: resetForm.code.trim(),
        requestId: resetForm.requestId,
        newPassword: resetForm.newPassword,
      });
      // Back to password login with the phone pre-filled — the user
      // resets in order to log in, so put them one field away.
      setIsResetMode(false);
      setLoginMethod('password');
      setLoginForm({ phone: resetForm.phone, password: '' });
      setResetForm({
        phone: '',
        code: '',
        requestId: undefined,
        newPassword: '',
        confirmPassword: '',
      });
      showModal('success', '重置成功', '密码已更新，请用新密码登录。');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '重置失败，请重试';
      showModal('error', '错误', message);
    } finally {
      setIsLoading(false);
    }
  };

  // 显示协议 — 文本单源在 lib/legal-content.ts(与关于页共享)
  const handleShowAgreement = (type: 'user' | 'privacy') => {
    const title = type === 'user' ? USER_AGREEMENT_TITLE : PRIVACY_POLICY_TITLE;
    const content = type === 'user' ? USER_AGREEMENT_TEXT : PRIVACY_POLICY_TEXT;
    showModal('agreement', title, '', content);
  };

  // 清理定时器
  React.useEffect(() => {
    return () => {
      if (countdownInterval.current) {
        clearInterval(countdownInterval.current);
      }
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* Flat paper, not the sand gradient. CLINICAL_GRADIENTS.page is
          ['#F8F2EA', …], the palette lib/design.ts explicitly rejected
          — its own comment says #F8F2EA "pulled yellow enough to grey
          out the teal sitting on it" — so the last four screens using
          it were painting their page in the rejected colour underneath
          the accent it greys out. */}
      <View style={styles.backgroundGradient}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoidingView}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={styles.scrollViewContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo和产品名称区域 */}
            <View style={styles.header}>
              <View style={styles.headerTopRow}>
                <ScreenBackButton fallbackHref="/p-login_register" />
              </View>
              <View style={styles.logoContainer}>
                <Animated.View style={[styles.logoWrapper, logoAnimatedStyle]}>
                  <View style={styles.logoCard}>
                    <Icon name="heartbeat" size={24} style={styles.logoIcon} />
                  </View>
                </Animated.View>
                <Text style={styles.appName}>FSHD-openrd</Text>
                <Text style={styles.appSlogan}>智能FSHD管理平台</Text>
              </View>
            </View>

            {/* 登录注册表单 */}
            <View
              style={styles.mainContent}
              onLayout={(event) => {
                sectionYRef.current.main = event.nativeEvent.layout.y;
              }}
            >
              {/* 切换标签 */}
              <SegmentedControl
                segments={[
                  { key: 'login', label: '登录' },
                  { key: 'register', label: '注册' },
                ]}
                value={activeTab}
                onChange={(key) => handleTabSwitch(key as 'login' | 'register')}
                accessibilityLabel="登录或注册"
                style={styles.tabSwitcher}
              />

              {/* 登录表单 */}
              {activeTab === 'login' && !isResetMode && (
                <View style={styles.formContainer}>
                  {/* 密码登录 / 验证码登录 — one exclusive choice. It
                      borrowed the register form's identityRow style,
                      which is why it looked like the same control. */}
                  <SegmentedControl
                    segments={[
                      { key: 'password', label: '密码登录' },
                      { key: 'otp', label: '验证码登录' },
                    ]}
                    value={loginMethod}
                    onChange={(key) => setLoginMethod(key as 'password' | 'otp')}
                    accessibilityLabel="登录方式"
                  />

                  {loginMethod === 'password' ? (
                    <>
                      <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>手机号</Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="请输入手机号"
                          placeholderTextColor={COLOR.inkMuted}
                          value={loginForm.phone}
                          onChangeText={(text) =>
                            setLoginForm((prev) => ({ ...prev, phone: text }))
                          }
                          {...PHONE_FIELD_PROPS}
                          maxLength={11}
                        />
                        {renderLoginError('phone')}
                      </View>

                      <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>密码</Text>
                        <View style={styles.passwordInputWrapper}>
                          <TextInput
                            style={styles.passwordInput}
                            placeholder="请输入密码"
                            placeholderTextColor={COLOR.inkMuted}
                            value={loginForm.password}
                            onChangeText={(text) =>
                              setLoginForm((prev) => ({ ...prev, password: text }))
                            }
                            {...CURRENT_PASSWORD_FIELD_PROPS}
                            secureTextEntry={!isLoginPasswordVisible}
                            maxLength={PASSWORD_MAX_LENGTH}
                          />
                          <PressableScale
                            style={styles.passwordToggleButton}
                            accessibilityRole="button"
                            accessibilityLabel={isLoginPasswordVisible ? '隐藏密码' : '显示密码'}
                            onPress={() => togglePasswordVisibility('login')}
                          >
                            <Icon
                              name={isLoginPasswordVisible ? 'eye-slash' : 'eye'}
                              size={16}
                              color={COLOR.inkMuted}
                            />
                          </PressableScale>
                        </View>
                        {renderLoginError('password')}
                      </View>

                      <Button
                        label="登录"
                        variant="prominent"
                        fullWidth
                        busy={isLoading}
                        onPress={handleLoginSubmit}
                      />
                    </>
                  ) : (
                    <>
                      <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>手机号</Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="请输入手机号"
                          placeholderTextColor={COLOR.inkMuted}
                          value={otpLoginForm.phone}
                          onChangeText={(text) => {
                            setOtpLoginForm((prev) => ({ ...prev, phone: text }));
                            setOtpLoginErrors((prev) => ({ ...prev, phone: '' }));
                          }}
                          {...PHONE_FIELD_PROPS}
                          maxLength={11}
                        />
                        {otpLoginErrors.phone ? (
                          <Text style={styles.fieldErrorText}>{otpLoginErrors.phone}</Text>
                        ) : null}
                      </View>

                      <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>验证码</Text>
                        <View style={styles.verificationCodeWrapper}>
                          <TextInput
                            style={styles.verificationCodeInput}
                            placeholder="请输入验证码"
                            placeholderTextColor={COLOR.inkMuted}
                            value={otpLoginForm.code}
                            onChangeText={(text) => {
                              setOtpLoginForm((prev) => ({ ...prev, code: text }));
                              setOtpLoginErrors((prev) => ({ ...prev, code: '' }));
                            }}
                            {...OTP_FIELD_PROPS}
                            maxLength={6}
                          />
                          <Button
                            label={countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                            variant="tinted"
                            compact
                            busy={isSendingCode}
                            disabled={countdown > 0}
                            accessibilityLabel="获取短信验证码"
                            style={styles.getCodeButton}
                            onPress={() => {
                              if (!isValidChinaMobile(otpLoginForm.phone)) {
                                setOtpLoginErrors((prev) => ({
                                  ...prev,
                                  phone: otpLoginForm.phone ? '请输入正确的手机号' : '请输入手机号',
                                }));
                                return;
                              }
                              void requestOtpCode('login', otpLoginForm.phone, (requestId) =>
                                setOtpLoginForm((prev) => ({ ...prev, requestId })),
                              );
                            }}
                          />
                        </View>
                        {otpLoginErrors.code ? (
                          <Text style={styles.fieldErrorText}>{otpLoginErrors.code}</Text>
                        ) : null}
                      </View>

                      <Button
                        label="验证码登录"
                        variant="prominent"
                        fullWidth
                        busy={isLoading}
                        onPress={handleOtpLoginSubmit}
                      />
                    </>
                  )}
                </View>
              )}

              {/* 重置密码 */}
              {activeTab === 'login' && isResetMode && (
                <View style={styles.formContainer}>
                  <Text style={styles.registerSectionTitle}>重置密码</Text>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>手机号</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入注册时的手机号"
                      placeholderTextColor={COLOR.inkMuted}
                      value={resetForm.phone}
                      onChangeText={(text) => {
                        setResetForm((prev) => ({ ...prev, phone: text }));
                        setResetErrors((prev) => ({ ...prev, phone: '' }));
                      }}
                      {...PHONE_FIELD_PROPS}
                      maxLength={11}
                    />
                    {resetErrors.phone ? (
                      <Text style={styles.fieldErrorText}>{resetErrors.phone}</Text>
                    ) : null}
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>验证码</Text>
                    <View style={styles.verificationCodeWrapper}>
                      <TextInput
                        style={styles.verificationCodeInput}
                        placeholder="请输入验证码"
                        placeholderTextColor={COLOR.inkMuted}
                        value={resetForm.code}
                        onChangeText={(text) => {
                          setResetForm((prev) => ({ ...prev, code: text }));
                          setResetErrors((prev) => ({ ...prev, code: '' }));
                        }}
                        {...OTP_FIELD_PROPS}
                        maxLength={6}
                      />
                      <Button
                        label={countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                        variant="tinted"
                        compact
                        busy={isSendingCode}
                        disabled={countdown > 0}
                        accessibilityLabel="获取短信验证码"
                        style={styles.getCodeButton}
                        onPress={() => {
                          if (!isValidChinaMobile(resetForm.phone)) {
                            setResetErrors((prev) => ({
                              ...prev,
                              phone: resetForm.phone ? '请输入正确的手机号' : '请输入手机号',
                            }));
                            return;
                          }
                          void requestOtpCode('reset', resetForm.phone, (requestId) =>
                            setResetForm((prev) => ({ ...prev, requestId })),
                          );
                        }}
                      />
                    </View>
                    {resetErrors.code ? (
                      <Text style={styles.fieldErrorText}>{resetErrors.code}</Text>
                    ) : null}
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>新密码</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder={`请设置${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位新密码`}
                      placeholderTextColor={COLOR.inkMuted}
                      value={resetForm.newPassword}
                      onChangeText={(text) => {
                        setResetForm((prev) => ({ ...prev, newPassword: text }));
                        setResetErrors((prev) => ({ ...prev, newPassword: '' }));
                      }}
                      {...NEW_PASSWORD_FIELD_PROPS}
                      secureTextEntry
                      maxLength={PASSWORD_MAX_LENGTH}
                    />
                    {resetErrors.newPassword ? (
                      <Text style={styles.fieldErrorText}>{resetErrors.newPassword}</Text>
                    ) : null}
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>确认新密码</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请再次输入新密码"
                      placeholderTextColor={COLOR.inkMuted}
                      value={resetForm.confirmPassword}
                      onChangeText={(text) => {
                        setResetForm((prev) => ({ ...prev, confirmPassword: text }));
                        setResetErrors((prev) => ({ ...prev, confirmPassword: '' }));
                      }}
                      {...NEW_PASSWORD_FIELD_PROPS}
                      secureTextEntry
                      maxLength={PASSWORD_MAX_LENGTH}
                    />
                    {resetErrors.confirmPassword ? (
                      <Text style={styles.fieldErrorText}>{resetErrors.confirmPassword}</Text>
                    ) : null}
                  </View>

                  <Button
                    label="重置密码"
                    variant="prominent"
                    fullWidth
                    busy={isLoading}
                    onPress={handlePasswordResetSubmit}
                  />

                  <View style={styles.forgotPasswordContainer}>
                    {/* Not `compact` — see the note on 忘记密码？below. */}
                    <Button
                      label="返回登录"
                      variant="plain"
                      onPress={() => setIsResetMode(false)}
                    />
                  </View>
                </View>
              )}

              {/* 注册表单 */}
              {activeTab === 'register' && (
                <View
                  style={styles.formContainer}
                  onLayout={(event) => {
                    sectionYRef.current.form = event.nativeEvent.layout.y;
                  }}
                >
                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('identity')}>
                    <Text style={styles.inputLabel}>身份选择</Text>
                    <SegmentedControl
                      segments={[
                        { key: 'doctor', label: '医生' },
                        { key: 'patient_family', label: '患者或家属' },
                        { key: 'other', label: '其他' },
                      ]}
                      value={registerForm.identity}
                      onChange={(key) =>
                        setRegisterForm((prev) => ({
                          ...prev,
                          identity: key as RegisterFormData['identity'],
                        }))
                      }
                      accessibilityLabel="身份选择"
                    />
                    {renderRegisterError('identity')}
                  </View>

                  <Text style={styles.registerSectionTitle}>账号信息</Text>
                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('phone')}>
                    <Text style={styles.inputLabel}>手机号</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入手机号"
                      placeholderTextColor={COLOR.inkMuted}
                      value={registerForm.phone}
                      onChangeText={(text) => setRegisterForm((prev) => ({ ...prev, phone: text }))}
                      {...PHONE_FIELD_PROPS}
                      maxLength={11}
                    />
                    {renderRegisterError('phone')}
                  </View>

                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('code')}>
                    <Text style={styles.inputLabel}>验证码</Text>
                    <View style={styles.verificationCodeWrapper}>
                      <TextInput
                        style={styles.verificationCodeInput}
                        placeholder="请输入验证码"
                        placeholderTextColor={COLOR.inkMuted}
                        value={registerForm.code}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, code: text }))
                        }
                        {...OTP_FIELD_PROPS}
                        maxLength={6}
                      />
                      <Button
                        label={countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
                        variant="tinted"
                        compact
                        busy={isSendingCode}
                        disabled={countdown > 0}
                        accessibilityLabel="获取短信验证码"
                        style={styles.getCodeButton}
                        onPress={handleGetVerificationCode}
                      />
                    </View>
                    {renderRegisterError('code')}
                  </View>

                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('password')}>
                    <Text style={styles.inputLabel}>设置密码</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder={`请设置${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位密码`}
                        placeholderTextColor={COLOR.inkMuted}
                        value={registerForm.password}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, password: text }))
                        }
                        {...NEW_PASSWORD_FIELD_PROPS}
                        secureTextEntry={!isRegisterPasswordVisible}
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <PressableScale
                        style={styles.passwordToggleButton}
                        accessibilityRole="button"
                        accessibilityLabel={isRegisterPasswordVisible ? '隐藏密码' : '显示密码'}
                        onPress={() => togglePasswordVisibility('register')}
                      >
                        <Icon
                          name={isRegisterPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color={COLOR.inkMuted}
                        />
                      </PressableScale>
                    </View>
                    {renderRegisterError('password')}
                  </View>

                  <View
                    style={styles.inputContainer}
                    onLayout={captureRegisterFieldY('confirmPassword')}
                  >
                    <Text style={styles.inputLabel}>确认密码</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder="请再次输入密码"
                        placeholderTextColor={COLOR.inkMuted}
                        value={registerForm.confirmPassword}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, confirmPassword: text }))
                        }
                        {...NEW_PASSWORD_FIELD_PROPS}
                        secureTextEntry={!isConfirmPasswordVisible}
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <PressableScale
                        style={styles.passwordToggleButton}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isConfirmPasswordVisible ? '隐藏确认密码' : '显示确认密码'
                        }
                        onPress={() => togglePasswordVisibility('confirm')}
                      >
                        <Icon
                          name={isConfirmPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color={COLOR.inkMuted}
                        />
                      </PressableScale>
                    </View>
                    {renderRegisterError('confirmPassword')}
                  </View>

                  <Button
                    label="注册"
                    variant="prominent"
                    fullWidth
                    busy={isLoading}
                    onPress={handleRegisterSubmit}
                  />
                </View>
              )}

              {/* 忘记密码 → 自助重置流

                  Deliberately NOT `compact`.

                  Measured live at 375×812, this and the two document
                  links below drew 34pt tall against this repo's own
                  MIN_TOUCH_TARGET of 48. `compact` pairs its 34pt with
                  a `hitSlop` that buys the difference back — but only
                  on device: react-native-web 0.20 reads `hitSlop` in
                  the legacy `Touchable` mixin and nowhere else, and
                  this product ships as a web export opened in WeChat's
                  browser. So the slop bought nothing for any real
                  patient, and this is the one screen every one of them
                  has to get through.

                  Full height rather than `expandHitSlop`, for the same
                  reason: lib/a11y.ts prefers slop for「text links and
                  small glyphs whose visual size is deliberately
                  modest」, and its own rule 1 is size beats precision.
                  A hit area the platform silently drops is not a hit
                  area, so the only honest fix here is drawn height. */}
              {activeTab === 'login' && !isResetMode && (
                <View style={styles.forgotPasswordContainer}>
                  <Button label="忘记密码？" variant="plain" onPress={() => setIsResetMode(true)} />
                </View>
              )}

              {/* 用户协议 / 隐私政策
                  The two documents used to be tappable spans inside the
                  sentence: 19pt tall (TYPE.caption's line box), no
                  accessibilityRole, and indistinguishable from the
                  prose except by colour — the exact「文字可以直接点」
                  shape this app was moving away from. They are now
                  controls, which is what they are.

                  What ALSO used to be here was the sentence
                 「登录即表示同意以下条款」, and that is the part that was
                  a legal defect rather than a UI one. 《个人信息保护法》
                  第 14 条 requires consent to be 「自愿、明确作出」;
                  inferring it from the act of pressing 注册 is neither
                  voluntary nor explicit, and nothing was recorded, so
                  there was no answer to 「这位患者同意过哪一版隐私政策」.
                  On the register tab the box below is un-prechecked and
                  blocks submission; the acceptance it produces is
                  written to the ledger (db/migrations/019).

                  On the login tab there is no checkbox and no implied
                  consent: an existing account's acceptance was recorded
                  when it registered, and re-asserting it on every login
                  would be the same inference in a new place. The
                  documents stay reachable because a user reading them
                  before signing in is the point. */}
              <View style={styles.agreement}>
                {activeTab === 'register' ? (
                  <>
                    {/* One control for the whole row: the box and its
                        sentence are the same target, so the 48pt
                        minimum applies to the text too rather than to a
                        20pt square a patient with reduced grip has to
                        hit. */}
                    {/* PressableScale, not a bare Pressable: this is the
                        one control that gates registration, and it was
                        the only control on the screen that answered a
                        press with nothing at all — no opacity, no
                        movement. */}
                    <PressableScale
                      style={styles.consentRow}
                      onPress={() => {
                        setHasAcceptedTerms((previous) => {
                          if (!previous) {
                            setTermsError(null);
                          }
                          return !previous;
                        });
                      }}
                      accessibilityRole="checkbox"
                      accessibilityLabel="我已阅读并同意《用户协议》和《隐私政策》"
                      accessibilityHint="必须勾选才能完成注册"
                      // Both spellings on purpose, same as ToggleSwitch:
                      // react-native-web 0.20 drops accessibilityState,
                      // which would leave the checkbox announcing itself
                      // without announcing whether it is ticked — on the
                      // one control that gates the whole registration.
                      accessibilityState={{ checked: hasAcceptedTerms }}
                      aria-checked={hasAcceptedTerms}
                    >
                      <View
                        style={[
                          styles.consentBox,
                          hasAcceptedTerms ? styles.consentBoxChecked : null,
                          termsError ? styles.consentBoxError : null,
                        ]}
                      >
                        {hasAcceptedTerms ? (
                          <Icon name="check" size={12} color={COLOR.surface} />
                        ) : null}
                      </View>
                      <Text style={styles.consentLabel}>
                        我已阅读并同意《用户协议》和《隐私政策》
                      </Text>
                    </PressableScale>
                    {termsError ? <Text style={styles.consentErrorText}>{termsError}</Text> : null}
                  </>
                ) : (
                  <Text style={styles.agreementText}>使用前请阅读以下条款</Text>
                )}
                {/* Also not `compact` — same 34pt measurement, same
                    reason. These two are what the consent checkbox
                    above is asking the patient to have read, so a
                    target they keep missing is a consent problem and
                    not only a comfort one. */}
                <View style={styles.agreementLinkRow}>
                  <Button
                    label="《用户协议》"
                    variant="plain"
                    onPress={() => handleShowAgreement('user')}
                  />
                  <Button
                    label="《隐私政策》"
                    variant="plain"
                    onPress={() => handleShowAgreement('privacy')}
                  />
                </View>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {/* 错误提示弹窗 */}
      {modalState.isVisible && modalState.type === 'error' && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconContainer}>
                <View style={styles.errorIconWrapper}>
                  <Icon name="triangle-exclamation" size={20} color={COLOR.alert} />
                </View>
              </View>
              <Text style={styles.modalTitle}>错误</Text>
              <Text style={styles.modalMessage}>{modalState.message}</Text>
              <Button label="确定" variant="prominent" fullWidth onPress={closeModal} />
            </View>
          </View>
        </View>
      )}

      {/* 成功提示弹窗 */}
      {modalState.isVisible && modalState.type === 'success' && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconContainer}>
                <View style={styles.successIconWrapper}>
                  <Icon name="check" size={20} color={COLOR.good} />
                </View>
              </View>
              <Text style={styles.modalTitle}>成功</Text>
              <Text style={styles.modalMessage}>{modalState.message}</Text>
              <Button label="确定" variant="prominent" fullWidth onPress={closeModal} />
            </View>
          </View>
        </View>
      )}

      {/* 协议详情弹窗 */}
      {modalState.isVisible && modalState.type === 'agreement' && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.agreementModalContent}>
              <View style={styles.agreementModalHeader}>
                <Text style={styles.agreementModalTitle}>{modalState.title}</Text>
                <PressableScale
                  style={styles.agreementModalClose}
                  accessibilityRole="button"
                  accessibilityLabel="关闭"
                  onPress={closeModal}
                >
                  <Icon name="xmark" size={16} color={COLOR.inkMuted} />
                </PressableScale>
              </View>
              <ScrollView style={styles.agreementModalScrollView}>
                <Text style={styles.agreementModalText}>{modalState.content}</Text>
              </ScrollView>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

export default LoginRegisterScreen;

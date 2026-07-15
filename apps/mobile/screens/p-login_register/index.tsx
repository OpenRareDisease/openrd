import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome5, FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import styles from './styles';
import { ApiError, login, loginWithOtp, register, resetPassword, sendOtp } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS } from '../../lib/clinical-visuals';
import { getSessionValue, setSessionValue } from '../../lib/session-storage';
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

// Interrupted-registration draft. Secrets (passwords) and OTP state
// are stripped before persisting — see the persist effect.
const REGISTER_FORM_DRAFT_KEY = 'openrd.register.draft';

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

  // Restore an interrupted registration (user switched away to read
  // the SMS, app got killed, …). Secrets and OTP state are NEVER
  // persisted — see the persist effect below.
  useEffect(() => {
    (async () => {
      try {
        const raw = await getSessionValue(REGISTER_FORM_DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw) as Partial<RegisterFormData>;
          delete draft.password;
          delete draft.confirmPassword;
          delete draft.code;
          delete draft.otpRequestId;
          setRegisterForm((prev) => ({ ...prev, ...draft }));
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
    setSessionValue(REGISTER_FORM_DRAFT_KEY, JSON.stringify(safeDraft)).catch(() => {
      // Draft persistence must never block typing.
    });
  }, [registerForm, isRegisterDraftHydrated]);

  // UI状态
  const [isLoginPasswordVisible, setIsLoginPasswordVisible] = useState(false);
  const [isRegisterPasswordVisible, setIsRegisterPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
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

    setIsLoading(true);

    try {
      const roleMap = {
        doctor: 'clinician',
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

  // 显示协议
  const handleShowAgreement = (type: 'user' | 'privacy') => {
    const title = type === 'user' ? '用户协议' : '隐私政策';
    const content =
      type === 'user'
        ? `1. 服务条款

欢迎使用FSHD-openrd应用程序。在使用本应用前，请仔细阅读并理解本用户协议。

2. 服务内容

本应用为FSHD患者提供健康管理、知识查询、社区交流等服务。

3. 用户责任

用户应确保提供真实、准确的个人信息，并妥善保管账户密码。

4. 隐私保护

我们严格保护用户隐私，具体请查看《隐私政策》。

5. 免责声明

本应用提供的信息仅供参考，不构成医疗建议，请在专业医生指导下使用。`
        : `1. 信息收集

我们收集您提供的个人信息和使用数据，用于提供更好的服务。

2. 信息使用

您的信息仅用于应用功能实现，不会用于其他商业目的。

3. 信息保护

我们采用行业标准的安全措施保护您的个人信息。

4. 信息共享

未经您同意，我们不会与第三方分享您的个人信息。

5. 数据删除

您可以随时申请删除账户和相关数据。`;

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
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
      >
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
                    <FontAwesome5 name="heartbeat" size={24} style={styles.logoIcon} />
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
              <View style={styles.tabSwitcher}>
                <TouchableOpacity
                  style={[
                    styles.tabButton,
                    styles.tabButtonLeft,
                    activeTab === 'login' && styles.tabButtonActive,
                  ]}
                  onPress={() => handleTabSwitch('login')}
                >
                  <Text
                    style={[
                      styles.tabButtonText,
                      activeTab === 'login' && styles.tabButtonTextActive,
                    ]}
                  >
                    登录
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.tabButton,
                    styles.tabButtonRight,
                    activeTab === 'register' && styles.tabButtonActive,
                  ]}
                  onPress={() => handleTabSwitch('register')}
                >
                  <Text
                    style={[
                      styles.tabButtonText,
                      activeTab === 'register' && styles.tabButtonTextActive,
                    ]}
                  >
                    注册
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 登录表单 */}
              {activeTab === 'login' && !isResetMode && (
                <View style={styles.formContainer}>
                  <View style={styles.identityRow}>
                    {(
                      [
                        { value: 'password', label: '密码登录' },
                        { value: 'otp', label: '验证码登录' },
                      ] as const
                    ).map((option) => {
                      const isActive = loginMethod === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[styles.identityButton, isActive && styles.identityButtonActive]}
                          onPress={() => setLoginMethod(option.value)}
                        >
                          <Text
                            style={[
                              styles.identityButtonText,
                              isActive && styles.identityButtonTextActive,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {loginMethod === 'password' ? (
                    <>
                      <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>手机号</Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="请输入手机号"
                          placeholderTextColor={CLINICAL_COLORS.textMuted}
                          value={loginForm.phone}
                          onChangeText={(text) =>
                            setLoginForm((prev) => ({ ...prev, phone: text }))
                          }
                          keyboardType="phone-pad"
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
                            placeholderTextColor={CLINICAL_COLORS.textMuted}
                            value={loginForm.password}
                            onChangeText={(text) =>
                              setLoginForm((prev) => ({ ...prev, password: text }))
                            }
                            secureTextEntry={!isLoginPasswordVisible}
                            maxLength={PASSWORD_MAX_LENGTH}
                          />
                          <TouchableOpacity
                            style={styles.passwordToggleButton}
                            onPress={() => togglePasswordVisibility('login')}
                          >
                            <FontAwesome6
                              name={isLoginPasswordVisible ? 'eye-slash' : 'eye'}
                              size={16}
                              color={CLINICAL_COLORS.textMuted}
                            />
                          </TouchableOpacity>
                        </View>
                        {renderLoginError('password')}
                      </View>

                      <TouchableOpacity
                        style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                        onPress={handleLoginSubmit}
                        disabled={isLoading}
                      >
                        <LinearGradient
                          colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.primaryButtonGradient}
                        >
                          <Text style={styles.primaryButtonText}>
                            {isLoading ? '登录中...' : '登录'}
                          </Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <View style={styles.inputContainer}>
                        <Text style={styles.inputLabel}>手机号</Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="请输入手机号"
                          placeholderTextColor={CLINICAL_COLORS.textMuted}
                          value={otpLoginForm.phone}
                          onChangeText={(text) => {
                            setOtpLoginForm((prev) => ({ ...prev, phone: text }));
                            setOtpLoginErrors((prev) => ({ ...prev, phone: '' }));
                          }}
                          keyboardType="phone-pad"
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
                            placeholderTextColor={CLINICAL_COLORS.textMuted}
                            value={otpLoginForm.code}
                            onChangeText={(text) => {
                              setOtpLoginForm((prev) => ({ ...prev, code: text }));
                              setOtpLoginErrors((prev) => ({ ...prev, code: '' }));
                            }}
                            keyboardType="number-pad"
                            maxLength={6}
                          />
                          <TouchableOpacity
                            style={[
                              styles.getCodeButton,
                              countdown > 0 && styles.getCodeButtonDisabled,
                            ]}
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
                            disabled={countdown > 0}
                          >
                            <Text style={styles.getCodeButtonText}>
                              {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {otpLoginErrors.code ? (
                          <Text style={styles.fieldErrorText}>{otpLoginErrors.code}</Text>
                        ) : null}
                      </View>

                      <TouchableOpacity
                        style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                        onPress={handleOtpLoginSubmit}
                        disabled={isLoading}
                      >
                        <LinearGradient
                          colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={styles.primaryButtonGradient}
                        >
                          <Text style={styles.primaryButtonText}>
                            {isLoading ? '登录中...' : '验证码登录'}
                          </Text>
                        </LinearGradient>
                      </TouchableOpacity>
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
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={resetForm.phone}
                      onChangeText={(text) => {
                        setResetForm((prev) => ({ ...prev, phone: text }));
                        setResetErrors((prev) => ({ ...prev, phone: '' }));
                      }}
                      keyboardType="phone-pad"
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
                        placeholderTextColor={CLINICAL_COLORS.textMuted}
                        value={resetForm.code}
                        onChangeText={(text) => {
                          setResetForm((prev) => ({ ...prev, code: text }));
                          setResetErrors((prev) => ({ ...prev, code: '' }));
                        }}
                        keyboardType="number-pad"
                        maxLength={6}
                      />
                      <TouchableOpacity
                        style={[
                          styles.getCodeButton,
                          countdown > 0 && styles.getCodeButtonDisabled,
                        ]}
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
                        disabled={countdown > 0}
                      >
                        <Text style={styles.getCodeButtonText}>
                          {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                        </Text>
                      </TouchableOpacity>
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
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={resetForm.newPassword}
                      onChangeText={(text) => {
                        setResetForm((prev) => ({ ...prev, newPassword: text }));
                        setResetErrors((prev) => ({ ...prev, newPassword: '' }));
                      }}
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
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={resetForm.confirmPassword}
                      onChangeText={(text) => {
                        setResetForm((prev) => ({ ...prev, confirmPassword: text }));
                        setResetErrors((prev) => ({ ...prev, confirmPassword: '' }));
                      }}
                      secureTextEntry
                      maxLength={PASSWORD_MAX_LENGTH}
                    />
                    {resetErrors.confirmPassword ? (
                      <Text style={styles.fieldErrorText}>{resetErrors.confirmPassword}</Text>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                    onPress={handlePasswordResetSubmit}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.primaryButtonGradient}
                    >
                      <Text style={styles.primaryButtonText}>
                        {isLoading ? '提交中...' : '重置密码'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <View style={styles.forgotPasswordContainer}>
                    <TouchableOpacity onPress={() => setIsResetMode(false)}>
                      <Text style={styles.forgotPasswordText}>返回登录</Text>
                    </TouchableOpacity>
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
                    <View style={styles.identityRow}>
                      {[
                        { value: 'doctor', label: '医生' },
                        { value: 'patient_family', label: '患者或家属' },
                        { value: 'other', label: '其他' },
                      ].map((option) => {
                        const isActive = registerForm.identity === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            style={[styles.identityButton, isActive && styles.identityButtonActive]}
                            onPress={() =>
                              setRegisterForm((prev) => ({
                                ...prev,
                                identity: option.value as RegisterFormData['identity'],
                              }))
                            }
                          >
                            <Text
                              style={[
                                styles.identityButtonText,
                                isActive && styles.identityButtonTextActive,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {renderRegisterError('identity')}
                  </View>

                  <Text style={styles.registerSectionTitle}>账号信息</Text>
                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('phone')}>
                    <Text style={styles.inputLabel}>手机号</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入手机号"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.phone}
                      onChangeText={(text) => setRegisterForm((prev) => ({ ...prev, phone: text }))}
                      keyboardType="phone-pad"
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
                        placeholderTextColor={CLINICAL_COLORS.textMuted}
                        value={registerForm.code}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, code: text }))
                        }
                        keyboardType="number-pad"
                        maxLength={6}
                      />
                      <TouchableOpacity
                        style={[
                          styles.getCodeButton,
                          countdown > 0 && styles.getCodeButtonDisabled,
                        ]}
                        onPress={handleGetVerificationCode}
                        disabled={countdown > 0}
                      >
                        <Text style={styles.getCodeButtonText}>
                          {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {renderRegisterError('code')}
                  </View>

                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('password')}>
                    <Text style={styles.inputLabel}>设置密码</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder={`请设置${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位密码`}
                        placeholderTextColor={CLINICAL_COLORS.textMuted}
                        value={registerForm.password}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, password: text }))
                        }
                        secureTextEntry={!isRegisterPasswordVisible}
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <TouchableOpacity
                        style={styles.passwordToggleButton}
                        onPress={() => togglePasswordVisibility('register')}
                      >
                        <FontAwesome6
                          name={isRegisterPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color={CLINICAL_COLORS.textMuted}
                        />
                      </TouchableOpacity>
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
                        placeholderTextColor={CLINICAL_COLORS.textMuted}
                        value={registerForm.confirmPassword}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, confirmPassword: text }))
                        }
                        secureTextEntry={!isConfirmPasswordVisible}
                        maxLength={PASSWORD_MAX_LENGTH}
                      />
                      <TouchableOpacity
                        style={styles.passwordToggleButton}
                        onPress={() => togglePasswordVisibility('confirm')}
                      >
                        <FontAwesome6
                          name={isConfirmPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color={CLINICAL_COLORS.textMuted}
                        />
                      </TouchableOpacity>
                    </View>
                    {renderRegisterError('confirmPassword')}
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                    onPress={handleRegisterSubmit}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.primaryButtonGradient}
                    >
                      <Text style={styles.primaryButtonText}>
                        {isLoading ? '注册中...' : '注册'}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </View>
              )}

              {/* 忘记密码 → 自助重置流 */}
              {activeTab === 'login' && !isResetMode && (
                <View style={styles.forgotPasswordContainer}>
                  <TouchableOpacity onPress={() => setIsResetMode(true)}>
                    <Text style={styles.forgotPasswordText}>忘记密码？</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 用户协议 */}
              <View style={styles.agreement}>
                <Text style={styles.agreementText}>
                  登录即表示同意{' '}
                  <Text style={styles.agreementLink} onPress={() => handleShowAgreement('user')}>
                    《用户协议》
                  </Text>{' '}
                  和{' '}
                  <Text style={styles.agreementLink} onPress={() => handleShowAgreement('privacy')}>
                    《隐私政策》
                  </Text>
                </Text>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      {/* 错误提示弹窗 */}
      {modalState.isVisible && modalState.type === 'error' && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <View style={styles.modalIconContainer}>
                <View style={styles.errorIconWrapper}>
                  <FontAwesome6
                    name="triangle-exclamation"
                    size={20}
                    color={CLINICAL_COLORS.danger}
                  />
                </View>
              </View>
              <Text style={styles.modalTitle}>错误</Text>
              <Text style={styles.modalMessage}>{modalState.message}</Text>
              <TouchableOpacity style={styles.modalButton} onPress={closeModal}>
                <Text style={styles.modalButtonText}>确定</Text>
              </TouchableOpacity>
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
                  <FontAwesome6 name="check" size={20} color={CLINICAL_COLORS.success} />
                </View>
              </View>
              <Text style={styles.modalTitle}>成功</Text>
              <Text style={styles.modalMessage}>{modalState.message}</Text>
              <TouchableOpacity style={styles.modalButton} onPress={closeModal}>
                <Text style={styles.modalButtonText}>确定</Text>
              </TouchableOpacity>
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
                <TouchableOpacity onPress={closeModal}>
                  <FontAwesome6 name="xmark" size={16} color={CLINICAL_COLORS.textMuted} />
                </TouchableOpacity>
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

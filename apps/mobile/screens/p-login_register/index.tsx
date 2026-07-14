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
import {
  ApiError,
  login,
  register,
  sendOtp,
  updateMyBaseline,
  upsertPatientProfile,
} from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS } from '../../lib/clinical-visuals';
import {
  type DateParts,
  buildRegionLabel,
  composeDate,
  genderOptions,
  parseDateParts,
} from '../../lib/demographics-options';
import { getSessionValue, setSessionValue } from '../../lib/session-storage';
import {
  AMBULATION_OPTIONS,
  ASSISTIVE_DEVICE_OPTIONS,
  type AmbulationChoice,
  type AssistiveDeviceOption,
  fromAmbulationChoice,
  mergeAssistiveDevices,
} from '../../lib/profile-baseline-options';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type LoginErrors,
  type LoginField,
  type RegisterErrors,
  type RegisterField,
  firstRegisterError,
  validateLoginForm,
  validateRegisterForm,
} from '../../lib/validation';
import { BirthDatePickers, RegionPickers } from '../common/DemographicsPickers';
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
  fullName: string;
  dateOfBirth: string;
  diagnosisYear: string;
  diagnosisType: string;
  onsetRegion: string;
  familyHistory: string;
  independentlyAmbulatory: AmbulationChoice;
  assistiveDevices: AssistiveDeviceOption[];
  customAssistiveDevices: string;
  gender: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say' | '';
  contactEmail: string;
  regionProvince: string;
  regionCity: string;
  regionDistrict: string;
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
  const [registerForm, setRegisterForm] = useState<RegisterFormData>({
    phone: '',
    code: '',
    otpRequestId: undefined,
    password: '',
    confirmPassword: '',
    identity: 'patient_family',
    fullName: '',
    dateOfBirth: '',
    diagnosisYear: '',
    diagnosisType: '',
    onsetRegion: '',
    familyHistory: '',
    independentlyAmbulatory: '',
    assistiveDevices: [],
    customAssistiveDevices: '',
    gender: '',
    contactEmail: '',
    regionProvince: '',
    regionCity: '',
    regionDistrict: '',
  });
  const [birthDateDraft, setBirthDateDraft] = useState<DateParts>(() => parseDateParts(''));
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
          if (typeof draft.dateOfBirth === 'string' && draft.dateOfBirth) {
            setBirthDateDraft(parseDateParts(draft.dateOfBirth));
          }
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
  const liveRegisterErrors = useMemo(
    () =>
      validateRegisterForm({
        ...registerForm,
        dateOfBirth: composeDate(birthDateDraft.year, birthDateDraft.month, birthDateDraft.day),
      }),
    [registerForm, birthDateDraft],
  );

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

    try {
      const response = await sendOtp({
        phoneNumber: formatPhoneNumber(registerForm.phone),
        scene: 'register',
      });
      setRegisterForm((prev) => ({
        ...prev,
        otpRequestId: response.requestId,
      }));

      // Prefer the server's actual resend interval; 60 is only the
      // fallback for older API builds that don't send it yet.
      startCountdown(response.retryAfterSeconds ?? 60);

      // Only surface `mockCode` in dev builds. The backend's mock
      // OTP provider returns it; prod uses Tencent. A misconfigured
      // staging env promoting an OTP_PROVIDER=mock value to prod
      // would otherwise print the secret straight to the success
      // toast. `__DEV__` is true in Expo dev builds and false in
      // production bundles.
      const message =
        __DEV__ && response.mockCode
          ? `验证码已发送（测试码：${response.mockCode}）`
          : '验证码已发送';
      showModal('success', '成功', message);
    } catch (error) {
      // Rate-limited: sync the countdown to the server's clock so the
      // button disables itself for exactly the remaining wait, and
      // tell the user the actual number instead of a generic failure.
      const waitSeconds = extractWaitSeconds(error);
      if (waitSeconds !== null) {
        startCountdown(waitSeconds);
        showModal('error', '发送过于频繁', `请在 ${waitSeconds} 秒后再试。`);
        return;
      }
      const message = error instanceof ApiError ? error.message : '验证码发送失败，请稍后重试';
      showModal('error', '错误', message);
    }
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
    const selectedDateOfBirth = composeDate(
      birthDateDraft.year,
      birthDateDraft.month,
      birthDateDraft.day,
    );

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

      await setSession(response);
      await upsertPatientProfile({
        fullName: registerForm.fullName.trim(),
        dateOfBirth: selectedDateOfBirth,
        gender: registerForm.gender,
        contactPhone: formatPhoneNumber(registerForm.phone),
        contactEmail: registerForm.contactEmail.trim() || null,
        regionProvince: registerForm.regionProvince.trim(),
        regionCity: registerForm.regionCity.trim(),
        regionDistrict: registerForm.regionDistrict.trim(),
      });
      await updateMyBaseline({
        foundation: {
          fullName: registerForm.fullName.trim(),
          birthYear: Number(selectedDateOfBirth.slice(0, 4)),
          diagnosisYear: registerForm.diagnosisYear.trim()
            ? Number(registerForm.diagnosisYear.trim())
            : null,
          regionLabel:
            buildRegionLabel({
              regionProvince: registerForm.regionProvince.trim(),
              regionCity: registerForm.regionCity.trim(),
              regionDistrict: registerForm.regionDistrict.trim(),
            }) || null,
        },
        diseaseBackground: {
          diagnosisType: registerForm.diagnosisType.trim() || null,
          onsetRegion: registerForm.onsetRegion.trim() || null,
          familyHistory: registerForm.familyHistory.trim() || null,
        },
        currentStatus: {
          independentlyAmbulatory: fromAmbulationChoice(registerForm.independentlyAmbulatory),
          assistiveDevices: mergeAssistiveDevices(
            registerForm.assistiveDevices,
            registerForm.customAssistiveDevices,
          ),
        },
      });
      // Registration is complete — the draft has served its purpose.
      await setSessionValue(REGISTER_FORM_DRAFT_KEY, null);
      showModal('success', '注册成功', '账户已创建并完成基础档案');
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '注册失败，请重试';
      showModal('error', '错误', message);
    } finally {
      setIsLoading(false);
    }
  };

  // 忘记密码
  const handleForgotPassword = () => {
    showModal('error', '提示', '忘记密码功能暂未开放，请联系客服');
  };

  // 第三方登录
  const handleThirdPartyLogin = (type: 'wechat' | 'alipay') => {
    const platform = type === 'wechat' ? '微信' : '支付宝';
    showModal('error', '提示', `${platform}登录功能暂未开放`);
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

  const handleBirthDateChange = (next: DateParts) => {
    setBirthDateDraft(next);
    setRegisterForm((prev) => ({
      ...prev,
      dateOfBirth: composeDate(next.year, next.month, next.day),
    }));
  };

  const toggleRegisterAssistiveDevice = (device: AssistiveDeviceOption) => {
    setRegisterForm((prev) => ({
      ...prev,
      assistiveDevices: prev.assistiveDevices.includes(device)
        ? prev.assistiveDevices.filter((item) => item !== device)
        : [...prev.assistiveDevices, device],
    }));
  };

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
              {activeTab === 'login' && (
                <View style={styles.formContainer}>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>手机号</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入手机号"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={loginForm.phone}
                      onChangeText={(text) => setLoginForm((prev) => ({ ...prev, phone: text }))}
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

                  <Text style={styles.registerSectionTitle}>基本信息</Text>
                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('fullName')}>
                    <Text style={styles.inputLabel}>姓名</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入姓名"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.fullName}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, fullName: text }))
                      }
                    />
                    {renderRegisterError('fullName')}
                  </View>
                  <View
                    style={styles.inputContainer}
                    onLayout={captureRegisterFieldY('dateOfBirth')}
                  >
                    <Text style={styles.inputLabel}>出生日期</Text>
                    <BirthDatePickers value={birthDateDraft} onChange={handleBirthDateChange} />
                    {renderRegisterError('dateOfBirth')}
                  </View>
                  <View style={styles.inputContainer} onLayout={captureRegisterFieldY('gender')}>
                    <Text style={styles.inputLabel}>性别</Text>
                    <View style={styles.identityRow}>
                      {genderOptions.map((option) => {
                        const isActive = registerForm.gender === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            style={[styles.identityButton, isActive && styles.identityButtonActive]}
                            onPress={() =>
                              setRegisterForm((prev) => ({
                                ...prev,
                                gender: option.value as RegisterFormData['gender'],
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
                  </View>

                  <Text style={styles.registerSectionTitle}>基础建档</Text>
                  <View
                    style={styles.inputContainer}
                    onLayout={captureRegisterFieldY('diagnosisYear')}
                  >
                    <Text style={styles.inputLabel}>确诊年份（可选）</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="例如：2022"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.diagnosisYear}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({
                          ...prev,
                          diagnosisYear: text.replace(/[^\d]/g, ''),
                        }))
                      }
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    {renderRegisterError('diagnosisYear')}
                    <Text style={styles.fieldHintText}>
                      如果还没有上传报告，也可以在下面先补充分型、首发部位和家族史。
                    </Text>
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>分型/诊断方式（可选）</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="例如：FSHD1"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.diagnosisType}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, diagnosisType: text }))
                      }
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>首发部位（可选）</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="例如：肩胛带、面部、足背屈"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.onsetRegion}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, onsetRegion: text }))
                      }
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>家族史（可选）</Text>
                    <TextInput
                      style={[styles.textInput, styles.multilineTextInput]}
                      placeholder="例如：母亲疑似，家中暂无明确患者"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.familyHistory}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, familyHistory: text }))
                      }
                      multiline
                      textAlignVertical="top"
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>当前行走（可选）</Text>
                    <View style={styles.choiceRow}>
                      {AMBULATION_OPTIONS.map((option) => {
                        const isActive = registerForm.independentlyAmbulatory === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            style={[styles.choiceButton, isActive && styles.choiceButtonActive]}
                            onPress={() =>
                              setRegisterForm((prev) => ({
                                ...prev,
                                independentlyAmbulatory:
                                  prev.independentlyAmbulatory === option.value ? '' : option.value,
                              }))
                            }
                          >
                            <Text
                              style={[
                                styles.choiceButtonText,
                                isActive && styles.choiceButtonTextActive,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>辅具（可选）</Text>
                    <View style={styles.choiceRow}>
                      {ASSISTIVE_DEVICE_OPTIONS.map((option) => {
                        const isActive = registerForm.assistiveDevices.includes(option);
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.choiceButton, isActive && styles.choiceButtonActive]}
                            onPress={() => toggleRegisterAssistiveDevice(option)}
                          >
                            <Text
                              style={[
                                styles.choiceButtonText,
                                isActive && styles.choiceButtonTextActive,
                              ]}
                            >
                              {option}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TextInput
                      style={styles.textInput}
                      placeholder="其他辅具可直接填写，多个用顿号分隔"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={registerForm.customAssistiveDevices}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, customAssistiveDevices: text }))
                      }
                    />
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

                  <Text style={styles.registerSectionTitle}>联系方式</Text>
                  <View
                    style={styles.inputContainer}
                    onLayout={captureRegisterFieldY('contactEmail')}
                  >
                    <Text style={styles.inputLabel}>邮箱（可选）</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="用于账号验证与平台通知"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      keyboardType="email-address"
                      value={registerForm.contactEmail}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, contactEmail: text }))
                      }
                    />
                    {renderRegisterError('contactEmail')}
                  </View>

                  <Text style={styles.registerSectionTitle}>所在地区</Text>
                  <View
                    style={styles.inputContainer}
                    onLayout={(event) => {
                      // The three region fields now share one shell —
                      // point all their scroll anchors at it so
                      // scroll-to-first-error still lands here.
                      const { y } = event.nativeEvent.layout;
                      registerFieldYRef.current.regionProvince = y;
                      registerFieldYRef.current.regionCity = y;
                      registerFieldYRef.current.regionDistrict = y;
                    }}
                  >
                    <Text style={styles.inputLabel}>省 / 市 / 区县</Text>
                    <RegionPickers
                      value={{
                        province: registerForm.regionProvince,
                        city: registerForm.regionCity,
                        district: registerForm.regionDistrict,
                      }}
                      onChange={(next) =>
                        setRegisterForm((prev) => ({
                          ...prev,
                          regionProvince: next.province,
                          regionCity: next.city,
                          regionDistrict: next.district,
                        }))
                      }
                    />
                    {renderRegisterError('regionProvince')}
                    {renderRegisterError('regionCity')}
                    {renderRegisterError('regionDistrict')}
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

              {/* 忘记密码 */}
              {activeTab === 'login' && (
                <View style={styles.forgotPasswordContainer}>
                  <TouchableOpacity onPress={handleForgotPassword}>
                    <Text style={styles.forgotPasswordText}>忘记密码？</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 分割线 */}
              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>或</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* 第三方登录 */}
              <View style={styles.thirdPartyLogin}>
                <TouchableOpacity
                  style={styles.thirdPartyButton}
                  onPress={() => handleThirdPartyLogin('wechat')}
                >
                  <FontAwesome6 name="weixin" size={18} color="#07C160" />
                  <Text style={styles.thirdPartyButtonText}>微信登录</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.thirdPartyButton}
                  onPress={() => handleThirdPartyLogin('alipay')}
                >
                  <FontAwesome6 name="alipay" size={18} color="#1677FF" />
                  <Text style={styles.thirdPartyButtonText}>支付宝登录</Text>
                </TouchableOpacity>
              </View>

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

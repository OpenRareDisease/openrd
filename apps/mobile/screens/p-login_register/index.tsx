import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
import { ApiError, login, register, sendOtp, upsertPatientProfile } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

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
    gender: '',
    contactEmail: '',
    regionProvince: '',
    regionCity: '',
    regionDistrict: '',
  });

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

  // 动画值
  const logoTranslateY = useSharedValue(0);

  // refs
  const countdownInterval = useRef<number | null>(null);

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

  // 表单验证函数
  const validatePhone = (phone: string): boolean => {
    const phoneRegex = /^1[3-9]\d{9}$/;
    return phoneRegex.test(phone);
  };

  const validatePassword = (password: string): boolean => {
    return password.length >= 8 && password.length <= 20;
  };

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

  const isValidDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    return !Number.isNaN(Date.parse(value));
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
  const handleGetVerificationCode = async () => {
    if (!registerForm.phone) {
      showModal('error', '错误', '请先输入手机号');
      return;
    }

    if (!validatePhone(registerForm.phone)) {
      showModal('error', '错误', '请输入正确的手机号');
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

      setCountdown(60);
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

      const message = response.mockCode
        ? `验证码已发送（测试码：${response.mockCode}）`
        : '验证码已发送';
      showModal('success', '成功', message);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '验证码发送失败，请稍后重试';
      showModal('error', '错误', message);
    }
  };

  // 登录提交
  const handleLoginSubmit = async () => {
    if (!loginForm.phone) {
      showModal('error', '错误', '请输入手机号');
      return;
    }

    if (!validatePhone(loginForm.phone)) {
      showModal('error', '错误', '请输入正确的手机号');
      return;
    }

    if (!loginForm.password) {
      showModal('error', '错误', '请输入密码');
      return;
    }

    setIsLoading(true);

    try {
      const response = await login({
        phoneNumber: formatPhoneNumber(loginForm.phone),
        password: loginForm.password,
      });

      await setSession(response);
      showModal('success', '登录成功', `欢迎回来，${response.user.phoneNumber}`);
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
    if (!registerForm.identity) {
      showModal('error', '错误', '请选择身份');
      return;
    }

    if (!registerForm.fullName.trim()) {
      showModal('error', '错误', '请输入姓名');
      return;
    }

    if (!registerForm.dateOfBirth.trim()) {
      showModal('error', '错误', '请输入出生日期');
      return;
    }

    if (!isValidDate(registerForm.dateOfBirth.trim())) {
      showModal('error', '错误', '出生日期格式应为YYYY-MM-DD');
      return;
    }

    if (!registerForm.gender) {
      showModal('error', '错误', '请选择性别');
      return;
    }

    if (!registerForm.phone) {
      showModal('error', '错误', '请输入手机号');
      return;
    }

    if (!validatePhone(registerForm.phone)) {
      showModal('error', '错误', '请输入正确的手机号');
      return;
    }

    if (!registerForm.code) {
      showModal('error', '错误', '请输入验证码');
      return;
    }

    if (!registerForm.password) {
      showModal('error', '错误', '请设置密码');
      return;
    }

    if (!validatePassword(registerForm.password)) {
      showModal('error', '错误', '密码长度应为8-20位');
      return;
    }

    if (registerForm.password !== registerForm.confirmPassword) {
      showModal('error', '错误', '两次输入的密码不一致');
      return;
    }

    if (!registerForm.regionProvince.trim()) {
      showModal('error', '错误', '请输入所在省份');
      return;
    }

    if (!registerForm.regionCity.trim()) {
      showModal('error', '错误', '请输入所在城市');
      return;
    }

    if (!registerForm.regionDistrict.trim()) {
      showModal('error', '错误', '请输入所在区县');
      return;
    }

    if (
      registerForm.contactEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registerForm.contactEmail.trim())
    ) {
      showModal('error', '错误', '请输入正确的邮箱格式');
      return;
    }

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
        dateOfBirth: registerForm.dateOfBirth.trim(),
        gender: registerForm.gender,
        contactPhone: formatPhoneNumber(registerForm.phone),
        contactEmail: registerForm.contactEmail.trim() || null,
        regionProvince: registerForm.regionProvince.trim(),
        regionCity: registerForm.regionCity.trim(),
        regionDistrict: registerForm.regionDistrict.trim(),
      });
      showModal('success', '注册成功', '账户已创建并完成档案');
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

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
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
            style={styles.scrollView}
            contentContainerStyle={styles.scrollViewContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo和产品名称区域 */}
            <View style={styles.header}>
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
            <View style={styles.mainContent}>
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
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={loginForm.phone}
                      onChangeText={(text) => setLoginForm((prev) => ({ ...prev, phone: text }))}
                      keyboardType="phone-pad"
                      maxLength={11}
                    />
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>密码</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder="请输入密码"
                        placeholderTextColor="rgba(255, 255, 255, 0.5)"
                        value={loginForm.password}
                        onChangeText={(text) =>
                          setLoginForm((prev) => ({ ...prev, password: text }))
                        }
                        secureTextEntry={!isLoginPasswordVisible}
                        maxLength={20}
                      />
                      <TouchableOpacity
                        style={styles.passwordToggleButton}
                        onPress={() => togglePasswordVisibility('login')}
                      >
                        <FontAwesome6
                          name={isLoginPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color="rgba(255, 255, 255, 0.5)"
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                    onPress={handleLoginSubmit}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={['#969FFF', '#5147FF']}
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
                <View style={styles.formContainer}>
                  <View style={styles.inputContainer}>
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
                  </View>

                  <Text style={styles.registerSectionTitle}>基本信息</Text>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>姓名</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入姓名"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={registerForm.fullName}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, fullName: text }))
                      }
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>出生日期</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={registerForm.dateOfBirth}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, dateOfBirth: text }))
                      }
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>性别</Text>
                    <View style={styles.identityRow}>
                      {[
                        { value: 'male', label: '男' },
                        { value: 'female', label: '女' },
                        { value: 'non_binary', label: '非二元' },
                        { value: 'prefer_not_to_say', label: '不透露' },
                      ].map((option) => {
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

                  <Text style={styles.registerSectionTitle}>账号信息</Text>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>手机号</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="请输入手机号"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={registerForm.phone}
                      onChangeText={(text) => setRegisterForm((prev) => ({ ...prev, phone: text }))}
                      keyboardType="phone-pad"
                      maxLength={11}
                    />
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>验证码</Text>
                    <View style={styles.verificationCodeWrapper}>
                      <TextInput
                        style={styles.verificationCodeInput}
                        placeholder="请输入验证码"
                        placeholderTextColor="rgba(255, 255, 255, 0.5)"
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
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>设置密码</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder="请设置6-20位密码"
                        placeholderTextColor="rgba(255, 255, 255, 0.5)"
                        value={registerForm.password}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, password: text }))
                        }
                        secureTextEntry={!isRegisterPasswordVisible}
                        maxLength={20}
                      />
                      <TouchableOpacity
                        style={styles.passwordToggleButton}
                        onPress={() => togglePasswordVisibility('register')}
                      >
                        <FontAwesome6
                          name={isRegisterPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color="rgba(255, 255, 255, 0.5)"
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>确认密码</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={styles.passwordInput}
                        placeholder="请再次输入密码"
                        placeholderTextColor="rgba(255, 255, 255, 0.5)"
                        value={registerForm.confirmPassword}
                        onChangeText={(text) =>
                          setRegisterForm((prev) => ({ ...prev, confirmPassword: text }))
                        }
                        secureTextEntry={!isConfirmPasswordVisible}
                        maxLength={20}
                      />
                      <TouchableOpacity
                        style={styles.passwordToggleButton}
                        onPress={() => togglePasswordVisibility('confirm')}
                      >
                        <FontAwesome6
                          name={isConfirmPasswordVisible ? 'eye-slash' : 'eye'}
                          size={16}
                          color="rgba(255, 255, 255, 0.5)"
                        />
                      </TouchableOpacity>
                    </View>
                  </View>

                  <Text style={styles.registerSectionTitle}>联系方式</Text>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>邮箱（可选）</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="用于账号验证与平台通知"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      keyboardType="email-address"
                      value={registerForm.contactEmail}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, contactEmail: text }))
                      }
                    />
                  </View>

                  <Text style={styles.registerSectionTitle}>所在地区</Text>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>省份</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="例如：浙江省"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={registerForm.regionProvince}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, regionProvince: text }))
                      }
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>城市</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="例如：杭州市"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={registerForm.regionCity}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, regionCity: text }))
                      }
                    />
                  </View>
                  <View style={styles.inputContainer}>
                    <Text style={styles.inputLabel}>区县</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="例如：西湖区"
                      placeholderTextColor="rgba(255, 255, 255, 0.5)"
                      value={registerForm.regionDistrict}
                      onChangeText={(text) =>
                        setRegisterForm((prev) => ({ ...prev, regionDistrict: text }))
                      }
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
                    onPress={handleRegisterSubmit}
                    disabled={isLoading}
                  >
                    <LinearGradient
                      colors={['#969FFF', '#5147FF']}
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
                  <FontAwesome6 name="triangle-exclamation" size={20} color="#FF4D4F" />
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
                  <FontAwesome6 name="check" size={20} color="#52C41A" />
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
                  <FontAwesome6 name="xmark" size={16} color="rgba(255, 255, 255, 0.5)" />
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

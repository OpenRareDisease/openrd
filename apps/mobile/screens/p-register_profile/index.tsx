import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import {
  ApiError,
  type BaselineProfilePayload,
  getMyPatientProfile,
  updateMyBaseline,
  upsertPatientProfile,
} from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS } from '../../lib/clinical-visuals';
import { useAuth } from '../../contexts/AuthContext';
import {
  AMBULATION_OPTIONS,
  ASSISTIVE_DEVICE_OPTIONS,
  type AmbulationChoice,
  type AssistiveDeviceOption,
  fromAmbulationChoice,
  mergeAssistiveDevices,
  splitAssistiveDevices,
  toAmbulationChoice,
} from '../../lib/profile-baseline-options';
import {
  type DateParts,
  buildRegionLabel,
  composeDate,
  genderOptions,
  parseDateParts,
} from '../../lib/demographics-options';
import { getSessionValue, setSessionValue } from '../../lib/session-storage';
import { BirthDatePickers, RegionPickers } from '../common/DemographicsPickers';
import ScreenBackButton from '../common/ScreenBackButton';
import { useProfileContext } from '../../contexts/ProfileContext';

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
};

// Unsaved-edit draft, restored on top of the server profile so a
// half-finished edit survives leaving the screen. Cleared on save.
const PROFILE_FORM_DRAFT_KEY = 'openrd.registerProfile.draft';

const RegisterProfileScreen: React.FC = () => {
  const router = useRouter();
  const params = useLocalSearchParams();
  // Onboarding mode: the root-layout gate sends profile-less users
  // here. Only the three fields the backend requires are mandatory
  // (~1 minute), everything else is deferred, and there is no back
  // button — the gate would bounce a back-navigation anyway.
  const isOnboarding = (Array.isArray(params.mode) ? params.mode[0] : params.mode) === 'onboarding';
  const { refresh: refreshProfileGate } = useProfileContext();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(
    null,
  );
  const [existingBaseline, setExistingBaseline] = useState<BaselineProfilePayload | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    dateOfBirth: '',
    diagnosisYear: '',
    diagnosisType: '',
    onsetRegion: '',
    familyHistory: '',
    independentlyAmbulatory: '' as AmbulationChoice,
    assistiveDevices: [] as AssistiveDeviceOption[],
    customAssistiveDevices: '',
    gender: '',
    contactPhone: user?.phoneNumber ?? '',
    contactEmail: user?.email ?? '',
    regionProvince: '',
    regionCity: '',
    regionDistrict: '',
  });
  // Wheel-picker state for date of birth; kept in sync with
  // form.dateOfBirth (the canonical YYYY-MM-DD used by validation
  // and the submit payload).
  const [birthDateDraft, setBirthDateDraft] = useState<DateParts>(() => parseDateParts(''));

  const contactHint = useMemo(() => {
    if (form.contactPhone || form.contactEmail) {
      return '用于账号验证与平台通知';
    }
    return '请输入手机号或邮箱';
  }, [form.contactPhone, form.contactEmail]);

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      // Read the unsaved-edit draft FIRST, independent of the profile
      // fetch: the users who most need it (no profile row yet → the
      // fetch 404s) would otherwise skip the restore, and the persist
      // effect would then overwrite their draft with the empty form.
      let draft: Partial<typeof form> | null = null;
      try {
        const rawDraft = await getSessionValue(PROFILE_FORM_DRAFT_KEY);
        draft = rawDraft ? (JSON.parse(rawDraft) as Partial<typeof form>) : null;
      } catch {
        draft = null;
      }

      try {
        const profile = await getMyPatientProfile();
        if (!isMounted || !profile) {
          return;
        }
        const baseline = profile.baseline ?? null;
        const diseaseBackground = baseline?.diseaseBackground;
        const currentStatus = baseline?.currentStatus;
        const assistiveDevices = splitAssistiveDevices(currentStatus?.assistiveDevices);
        setExistingBaseline(baseline);
        const serverForm = {
          fullName: profile.fullName ?? '',
          dateOfBirth: profile.dateOfBirth ?? '',
          diagnosisYear:
            baseline?.foundation?.diagnosisYear !== undefined &&
            baseline?.foundation?.diagnosisYear !== null
              ? String(baseline.foundation.diagnosisYear)
              : '',
          diagnosisType: diseaseBackground?.diagnosisType ?? '',
          onsetRegion: diseaseBackground?.onsetRegion ?? '',
          familyHistory: diseaseBackground?.familyHistory ?? '',
          independentlyAmbulatory: toAmbulationChoice(currentStatus?.independentlyAmbulatory),
          assistiveDevices: assistiveDevices.selected,
          customAssistiveDevices: assistiveDevices.customText,
          gender: profile.gender ?? '',
          regionProvince: profile.regionProvince ?? '',
          regionCity: profile.regionCity ?? '',
          regionDistrict: profile.regionDistrict ?? '',
        };

        // Draft-on-top-of-server: a half-finished edit (user left the
        // screen mid-way) wins over the stored profile, same layering
        // p-data_entry uses. Cleared on successful save.
        setForm((prev) => ({
          ...prev,
          ...serverForm,
          contactPhone: profile.contactPhone ?? prev.contactPhone,
          contactEmail: profile.contactEmail ?? prev.contactEmail,
          ...(draft ?? {}),
        }));
        setBirthDateDraft(
          parseDateParts(
            typeof draft?.dateOfBirth === 'string' ? draft.dateOfBirth : serverForm.dateOfBirth,
          ),
        );
      } catch (error) {
        const is404 = error instanceof ApiError && error.status === 404;
        const message = error instanceof ApiError ? error.message : '加载档案失败';
        if (isMounted) {
          // A 404 in onboarding mode is the EXPECTED state (the gate
          // sent us here precisely because no profile exists) — an
          // error banner would just confuse a brand-new user.
          if (!(is404 && isOnboarding)) {
            setFeedback({ type: 'error', message });
          }
          // No server profile (404 / transient error) — the draft is
          // still the user's latest work; restore it over the blank
          // form so the persist effect can't wipe it.
          if (draft) {
            setForm((prev) => ({ ...prev, ...draft }));
            if (typeof draft.dateOfBirth === 'string' && draft.dateOfBirth) {
              setBirthDateDraft(parseDateParts(draft.dateOfBirth));
            }
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
          setIsDraftHydrated(true);
        }
      }
    };

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  // Persist unsaved edits so leaving the screen (or an app kill)
  // doesn't discard a 15-field form. Hydration guard prevents the
  // initial empty state from overwriting an existing draft.
  useEffect(() => {
    if (!isDraftHydrated) {
      return;
    }
    setSessionValue(PROFILE_FORM_DRAFT_KEY, JSON.stringify(form)).catch(() => {
      // Draft persistence must never block editing.
    });
  }, [form, isDraftHydrated]);

  const toggleAssistiveDevice = (device: AssistiveDeviceOption) => {
    setForm((prev) => ({
      ...prev,
      assistiveDevices: prev.assistiveDevices.includes(device)
        ? prev.assistiveDevices.filter((item) => item !== device)
        : [...prev.assistiveDevices, device],
    }));
  };

  const handleSubmit = async () => {
    setFeedback(null);
    if (!form.fullName.trim()) {
      setFeedback({ type: 'error', message: '请输入姓名' });
      return;
    }

    if (!form.dateOfBirth.trim()) {
      setFeedback({ type: 'error', message: '请输入出生日期' });
      return;
    }

    if (!isValidDate(form.dateOfBirth.trim())) {
      setFeedback({ type: 'error', message: '出生日期格式应为 YYYY-MM-DD' });
      return;
    }

    if (!form.gender) {
      setFeedback({ type: 'error', message: '请选择性别' });
      return;
    }

    // Onboarding asks for the bare minimum (name/birth/gender) —
    // contact and region are deferred to「稍后完善」. Full mode keeps
    // the complete requirement set.
    if (!isOnboarding) {
      if (!form.contactPhone.trim() && !form.contactEmail.trim()) {
        setFeedback({ type: 'error', message: '请至少填写手机号或邮箱' });
        return;
      }

      if (form.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contactEmail)) {
        setFeedback({ type: 'error', message: '请输入正确的邮箱格式' });
        return;
      }

      if (form.diagnosisYear.trim() && !/^\d{4}$/.test(form.diagnosisYear.trim())) {
        setFeedback({ type: 'error', message: '确诊年份请填写 4 位年份' });
        return;
      }

      if (!form.regionProvince.trim() || !form.regionCity.trim() || !form.regionDistrict.trim()) {
        setFeedback({ type: 'error', message: '请完整填写省市区信息' });
        return;
      }
    }

    setIsSaving(true);

    try {
      const trimmedPhone = form.contactPhone.trim();
      const trimmedEmail = form.contactEmail.trim();
      await upsertPatientProfile({
        fullName: form.fullName.trim(),
        dateOfBirth: form.dateOfBirth.trim(),
        gender: form.gender,
        contactPhone: trimmedPhone ? trimmedPhone : null,
        contactEmail: trimmedEmail ? trimmedEmail : null,
        regionProvince: form.regionProvince.trim(),
        regionCity: form.regionCity.trim(),
        regionDistrict: form.regionDistrict.trim(),
      });
      await updateMyBaseline({
        ...(existingBaseline ?? {}),
        foundation: {
          ...(existingBaseline?.foundation ?? {}),
          fullName: form.fullName.trim(),
          birthYear: Number(form.dateOfBirth.slice(0, 4)),
          diagnosisYear: form.diagnosisYear.trim() ? Number(form.diagnosisYear.trim()) : null,
          regionLabel:
            buildRegionLabel({
              regionProvince: form.regionProvince.trim(),
              regionCity: form.regionCity.trim(),
              regionDistrict: form.regionDistrict.trim(),
            }) || null,
        },
        diseaseBackground: {
          ...(existingBaseline?.diseaseBackground ?? {}),
          diagnosisType: form.diagnosisType.trim() || null,
          onsetRegion: form.onsetRegion.trim() || null,
          familyHistory: form.familyHistory.trim() || null,
        },
        currentStatus: {
          ...(existingBaseline?.currentStatus ?? {}),
          independentlyAmbulatory: fromAmbulationChoice(form.independentlyAmbulatory),
          assistiveDevices: mergeAssistiveDevices(
            form.assistiveDevices,
            form.customAssistiveDevices,
          ),
        },
      });
      // The saved state is now canonical on the server — drop the
      // unsaved-edit draft so it doesn't shadow future loads.
      await setSessionValue(PROFILE_FORM_DRAFT_KEY, null);
      // Tell the onboarding gate the profile now exists BEFORE
      // navigating — otherwise the gate's 'missing' state would
      // bounce us straight back here.
      await refreshProfileGate();
      setFeedback({ type: 'success', message: '档案已保存' });
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '保存失败，请重试';
      setFeedback({ type: 'error', message });
    } finally {
      setIsSaving(false);
    }
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
        <View style={styles.header}>
          {isOnboarding ? null : <ScreenBackButton />}
          <Text style={styles.headerTitle}>
            {isOnboarding ? '完成基础档案（约 1 分钟）' : '编辑档案'}
          </Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={CLINICAL_COLORS.accent} />
            </View>
          ) : (
            <>
              {feedback && (
                <View
                  style={[
                    styles.feedbackBanner,
                    feedback.type === 'error' ? styles.feedbackError : styles.feedbackSuccess,
                  ]}
                >
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              )}
              {isOnboarding ? (
                <View style={styles.section}>
                  <Text style={styles.sectionSubtitle}>
                    只需填写下面的基本信息就可以开始使用。其余内容（FSHD
                    背景、联系方式、所在地区）可以稍后在「我的 → 编辑档案」随时完善。
                  </Text>
                </View>
              ) : null}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>基本信息</Text>
                <Text style={styles.sectionSubtitle}>用于年龄分层分析、病程关联研究</Text>
                <View style={styles.card}>
                  <Text style={styles.inputLabel}>姓名</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="请输入姓名"
                    placeholderTextColor={CLINICAL_COLORS.textMuted}
                    value={form.fullName}
                    onChangeText={(text) => setForm((prev) => ({ ...prev, fullName: text }))}
                  />

                  <Text style={styles.inputLabel}>出生日期</Text>
                  <BirthDatePickers
                    value={birthDateDraft}
                    onChange={(next) => {
                      setBirthDateDraft(next);
                      setForm((prev) => ({
                        ...prev,
                        dateOfBirth: composeDate(next.year, next.month, next.day),
                      }));
                    }}
                  />

                  <Text style={styles.inputLabel}>性别</Text>
                  <View style={styles.optionRow}>
                    {genderOptions.map((option) => {
                      const isActive = form.gender === option.value;
                      return (
                        <TouchableOpacity
                          key={option.value}
                          style={[styles.optionButton, isActive && styles.optionButtonActive]}
                          onPress={() => setForm((prev) => ({ ...prev, gender: option.value }))}
                        >
                          <Text
                            style={[styles.optionText, isActive && styles.optionTextActive]}
                            numberOfLines={1}
                          >
                            {option.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>

              {!isOnboarding && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>FSHD 背景</Text>
                  <Text style={styles.sectionSubtitle}>补充不会从报告自动识别出来的关键信息</Text>
                  <View style={styles.card}>
                    <Text style={styles.inputLabel}>确诊年份</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如：2022"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      keyboardType="number-pad"
                      maxLength={4}
                      value={form.diagnosisYear}
                      onChangeText={(text) =>
                        setForm((prev) => ({
                          ...prev,
                          diagnosisYear: text.replace(/[^\d]/g, ''),
                        }))
                      }
                    />

                    <Text style={styles.inputLabel}>分型/诊断方式</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如：FSHD1"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={form.diagnosisType}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, diagnosisType: text }))}
                    />

                    <Text style={styles.inputLabel}>首发部位</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如：肩胛带、面部、足背屈"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={form.onsetRegion}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, onsetRegion: text }))}
                    />

                    <Text style={styles.inputLabel}>家族史</Text>
                    <TextInput
                      style={[styles.input, styles.multilineInput]}
                      placeholder="例如：母亲疑似，家中暂无明确患者"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={form.familyHistory}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, familyHistory: text }))}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.inputLabel}>当前行走</Text>
                    <View style={styles.optionRow}>
                      {AMBULATION_OPTIONS.map((option) => {
                        const isActive = form.independentlyAmbulatory === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            style={[styles.optionButton, isActive && styles.optionButtonActive]}
                            onPress={() =>
                              setForm((prev) => ({
                                ...prev,
                                independentlyAmbulatory:
                                  prev.independentlyAmbulatory === option.value ? '' : option.value,
                              }))
                            }
                          >
                            <Text
                              style={[styles.optionText, isActive && styles.optionTextActive]}
                              numberOfLines={1}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.inputLabel}>辅具</Text>
                    <View style={styles.optionRow}>
                      {ASSISTIVE_DEVICE_OPTIONS.map((option) => {
                        const isActive = form.assistiveDevices.includes(option);
                        return (
                          <TouchableOpacity
                            key={option}
                            style={[styles.optionButton, isActive && styles.optionButtonActive]}
                            onPress={() => toggleAssistiveDevice(option)}
                          >
                            <Text
                              style={[styles.optionText, isActive && styles.optionTextActive]}
                              numberOfLines={1}
                            >
                              {option}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="其他辅具可直接填写，多个用顿号分隔"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      value={form.customAssistiveDevices}
                      onChangeText={(text) =>
                        setForm((prev) => ({ ...prev, customAssistiveDevices: text }))
                      }
                    />
                  </View>
                </View>
              )}

              {!isOnboarding && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>联系方式</Text>
                  <Text style={styles.sectionSubtitle}>{contactHint}</Text>
                  <View style={styles.card}>
                    <Text style={styles.inputLabel}>手机号</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="请输入手机号"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      keyboardType="phone-pad"
                      value={form.contactPhone}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, contactPhone: text }))}
                    />

                    <Text style={styles.inputLabel}>邮箱</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="请输入邮箱"
                      placeholderTextColor={CLINICAL_COLORS.textMuted}
                      keyboardType="email-address"
                      value={form.contactEmail}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, contactEmail: text }))}
                    />
                  </View>
                </View>
              )}

              {!isOnboarding && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>所在地区</Text>
                  <Text style={styles.sectionSubtitle}>用于统计区域发病率与线下活动筹备</Text>
                  <View style={styles.card}>
                    <Text style={styles.inputLabel}>省 / 市 / 区县</Text>
                    <RegionPickers
                      value={{
                        province: form.regionProvince,
                        city: form.regionCity,
                        district: form.regionDistrict,
                      }}
                      onChange={(next) =>
                        setForm((prev) => ({
                          ...prev,
                          regionProvince: next.province,
                          regionCity: next.city,
                          regionDistrict: next.district,
                        }))
                      }
                    />
                  </View>
                </View>
              )}

              <TouchableOpacity
                style={[styles.primaryButton, isSaving && styles.primaryButtonDisabled]}
                onPress={handleSubmit}
                disabled={isSaving}
              >
                <LinearGradient
                  colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.primaryButtonGradient}
                >
                  {isSaving ? (
                    <ActivityIndicator color={CLINICAL_COLORS.text} />
                  ) : (
                    <Text style={styles.primaryButtonText}>保存</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default RegisterProfileScreen;

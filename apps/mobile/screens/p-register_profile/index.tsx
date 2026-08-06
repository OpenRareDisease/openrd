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
import SensitiveDataConsentGate, {
  useSensitiveDataConsentGate,
} from '../p-privacy_settings/components/SensitiveDataConsentGate';
import { LEGAL_DOCUMENTS } from '../../lib/legal-content';
import { requiresGuardianConsent } from '../../lib/guardian-consent';
import styles from './styles';
import { baselineCarriesHealthData } from './baseline-payload';
import { PROFILE_FORM_DRAFT_KEY } from '../../lib/draft-keys';
import Button from '../common/Button';
import {
  ApiError,
  type BaselineProfilePayload,
  DIAGNOSIS_LADDER_LABELS,
  DIAGNOSIS_LADDER_STATES,
  type DiagnosisLadderState,
  getMyPatientProfile,
  updateMyBaseline,
  upsertPatientProfile,
} from '../../lib/api';
import { COLOR } from '../../lib/design';
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
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';
import { useProfileContext } from '../../contexts/ProfileContext';

/**
 * The stored ladder value, or '' — never a string this build cannot
 * render.
 *
 * `baseline` is an untyped JSONB column on the server and reaches the
 * client through `apiRequest`'s unchecked type assertion, so the value
 * on the wire is whatever some client wrote there. An unrecognised
 * string would select none of the five options while still sitting in
 * `form.diagnosisLadder`, and the save below would post it straight
 * back — where the API's `z.enum` rejects the whole baseline. The
 * patient would see 「保存失败」 on a form where every visible field is
 * fine. Falling back to unanswered puts the question back in front of
 * them instead, which is the only thing that can actually fix it.
 */
const readStoredLadder = (raw: unknown): DiagnosisLadderState | '' =>
  typeof raw === 'string' && (DIAGNOSIS_LADDER_STATES as readonly string[]).includes(raw)
    ? (raw as DiagnosisLadderState)
    : '';

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed);
};

// Unsaved-edit draft, restored on top of the server profile so a
// half-finished edit survives leaving the screen. Cleared on save.
// Key lives in lib/draft-keys.ts so logout can clear it without
// re-declaring the string (see that file's header).

const RegisterProfileScreen: React.FC = () => {
  const router = useRouter();
  const { notify } = useAppDialog();
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
  // Errors only. Success used to set this too, but it was set on the
  // line before a `router.replace` — painted and thrown away in the
  // same tick — and now goes through `notify`, which outlives the
  // navigation. Failures keep the inline banner because the patient
  // stays on this form to fix the field the message names.
  const [feedback, setFeedback] = useState<{ type: 'error'; message: string } | null>(null);
  const [existingBaseline, setExistingBaseline] = useState<BaselineProfilePayload | null>(null);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    dateOfBirth: '',
    diagnosisYear: '',
    // '' means「还没答」. Distinct from every one of the five rungs,
    // including 「还没测过，暂时不打算测」 — that one is an answer, and
    // the passport says something different to a person who gave it.
    diagnosisLadder: '' as DiagnosisLadderState | '',
    diagnosisType: '',
    d4z4: '',
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
        // The draft is JSON this build did not necessarily write — an
        // older bundle, a hand-edited store — and it is layered ON TOP
        // of the server value below, so an unrecognised ladder string
        // here would win over a good stored one and then be posted
        // back, where the API's z.enum rejects the whole baseline.
        //
        // The key is DROPPED rather than blanked, so the stored answer
        // survives an unreadable draft. '' is left alone on purpose: it
        // is what deselecting writes, and a patient who cleared the
        // question and walked away meant to clear it.
        if (draft && 'diagnosisLadder' in draft) {
          const drafted = draft.diagnosisLadder;
          if (drafted !== '' && !readStoredLadder(drafted)) {
            const sanitized: Partial<typeof form> = { ...draft };
            delete sanitized.diagnosisLadder;
            draft = sanitized;
          }
        }
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
          diagnosisLadder: readStoredLadder(diseaseBackground?.diagnosisLadder),
          diagnosisType: diseaseBackground?.diagnosisType ?? '',
          d4z4: diseaseBackground?.d4z4 != null ? String(diseaseBackground.d4z4) : '',
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

  // PIPL Art. 31. The gate keys off the birth date this very form
  // collects, which is why it lives here and not at sign-up: the
  // phone-number registration has no age to reason about yet.
  const { ensureSensitiveDataConsent: ensureGuardianConsent, gateProps: guardianGateProps } =
    useSensitiveDataConsentGate(LEGAL_DOCUMENTS.guardianConsent);
  // PIPL Art. 29. The baseline this form writes carries diagnosis type,
  // D4Z4 repeat count, haplotype and methylation — the privacy policy
  // names exactly those as 敏感个人信息 needing 单独同意, and this screen
  // was storing them before the document had ever been rendered. The
  // API refuses the write without a ledger row (requireSensitiveDataConsent
  // on PUT /me/baseline), so without this the save would just fail.
  const { ensureSensitiveDataConsent, gateProps: sensitiveGateProps } = useSensitiveDataConsentGate(
    LEGAL_DOCUMENTS.sensitiveData,
  );

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

    // Under 14: a parent or guardian has to consent on the patient's
    // behalf before the record exists, not after. The privacy policy's
    // §8 already promises this in writing; without the gate the promise
    // was the only place it happened.
    if (requiresGuardianConsent(form.dateOfBirth.trim())) {
      const consented = await ensureGuardianConsent();
      if (!consented) {
        setFeedback({
          type: 'error',
          message: '未满 14 周岁需监护人同意后才能建档。若出生日期填错了，请修改后重试。',
        });
        return;
      }
    }

    // The baseline is assembled here rather than at the call site so
    // the Art. 29 question below can be asked about what we are
    // actually about to store.
    const baselinePayload: BaselineProfilePayload = {
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
        // `null` when unanswered, and never a guess: there is no
        // inverse of `diagnosedFshdFromLadder` on the server, because
        // `true` could be any of the first three rungs and `false`
        // either of the last two. A profile written by an older client
        // simply has no ladder until its owner answers this question.
        //
        // Sending it also makes the server DERIVE `diagnosedFshd` from
        // it (profile.schema.ts), overwriting whatever the spread above
        // carried forward — which is what keeps the two halves from
        // saying opposite things on disk.
        diagnosisLadder: form.diagnosisLadder || null,
        diagnosisType: form.diagnosisType.trim() || null,
        d4z4: form.d4z4.trim() || existingBaseline?.diseaseBackground?.d4z4 || null,
        onsetRegion: form.onsetRegion.trim() || null,
        familyHistory: form.familyHistory.trim() || null,
      },
      currentStatus: {
        ...(existingBaseline?.currentStatus ?? {}),
        independentlyAmbulatory: fromAmbulationChoice(form.independentlyAmbulatory),
        assistiveDevices: mergeAssistiveDevices(form.assistiveDevices, form.customAssistiveDevices),
      },
    };
    // Onboarding renders name/birth/gender only, so the baseline it
    // builds is identity fields plus a row of nulls — and PUT
    // /me/baseline is consent-gated because of the clinical fields that
    // are not there. Asking a first-run user to accept the genetic-data
    // document to store nothing is not a consent, it is a toll: the
    // root layout's onboarding gate keeps sending a profile-less user
    // back to this form, so 「暂不同意」 locked them out of the app
    // entirely. Ask when there is something to ask about; the FSHD
    // background section and the first report upload both still do.
    const writesHealthData = baselineCarriesHealthData(baselinePayload);

    // Ordered after the guardian gate on purpose: for a child, the
    // person answering both questions is the guardian, and asking them
    // to consent to sensitive-data processing before establishing that
    // they may consent at all is the wrong way round.
    if (writesHealthData) {
      const sensitiveConsented = await ensureSensitiveDataConsent();
      if (!sensitiveConsented) {
        setFeedback({
          type: 'error',
          message: '未记录敏感个人信息处理同意，档案没有保存。诊断与基因信息需要这项同意才能存储。',
        });
        return;
      }
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
      // Skipped when the payload carries no health data: every field
      // it would have written is either null or already stored by
      // `upsertPatientProfile` above (fullName, dateOfBirth, region),
      // and every reader of `baseline.foundation` falls back to those
      // profile columns. Writing it anyway is what forced the consent
      // ask onto first-run users.
      if (writesHealthData) {
        await updateMyBaseline(baselinePayload);
      }
      // The saved state is now canonical on the server — drop the
      // unsaved-edit draft so it doesn't shadow future loads.
      await setSessionValue(PROFILE_FORM_DRAFT_KEY, null);
      // Tell the onboarding gate the profile now exists BEFORE
      // navigating — otherwise the gate's 'missing' state would
      // bounce us straight back here.
      await refreshProfileGate();
      // `setFeedback` renders inside this screen, and the very next
      // line leaves it — so the success banner was painted and
      // destroyed in the same tick and the patient saw nothing at all
      // after a 15-field save. The dialog provider lives at the root,
      // so this one survives the navigation and lands with them on the
      // home screen. The error path below keeps the inline banner,
      // because there the patient stays here and has to fix a field.
      notify({ title: '档案已保存', tone: 'success' });
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
      <View style={styles.backgroundGradient}>
        {/* Onboarding keeps a bare title: there is nowhere to go back
            to and no home to reach until this form is saved — the
            profile gate would bounce either control straight back
            here. Everywhere else gets the standard header, so 编辑档案
            now has the home control too. Unsaved edits survive leaving
            (the draft effect above persists every keystroke), so home
            costs no work. */}
        {isOnboarding ? (
          <View style={styles.header}>
            <View style={styles.headerPlaceholder} />
            <Text style={styles.headerTitle}>完成基础档案（约 1 分钟）</Text>
            <View style={styles.headerPlaceholder} />
          </View>
        ) : (
          <ScreenHeader title="编辑档案" style={styles.header} />
        )}

        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={COLOR.accent} />
            </View>
          ) : (
            <>
              {feedback && (
                <View style={[styles.feedbackBanner, styles.feedbackError]}>
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              )}
              {isOnboarding ? (
                <View style={styles.introNote}>
                  <Text style={styles.introNoteText}>
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
                    placeholderTextColor={COLOR.inkFaint}
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
                          accessibilityRole="radio"
                          accessibilityLabel={option.label}
                          accessibilityState={{ selected: isActive }}
                          aria-checked={isActive}
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
                    {/* The first question in this section, because it
                        frames every field under it. 「我被诊断为 FSHD」
                        used to be one boolean, and it collapsed five
                        situations that call for five different next
                        moves — most damagingly 「医生说是，但我没有基因
                        报告」 and 「测过，报告丢了」, both of which
                        answered `true` and were then read downstream as
                        a molecular diagnosis. The labels come from
                        lib/api.ts, mirrored from the API's
                        DIAGNOSIS_LADDER_LABELS; do not reword them
                        here. */}
                    <Text style={styles.inputLabel}>诊断进度</Text>
                    <Text style={styles.fieldHint}>
                      临床诊断和基因确诊不是一回事，这一项分开问。临床护照会据此说明下一步该做什么、
                      以及该向医院要哪一项检查；不填也可以，其余内容照常保存。
                    </Text>
                    <View style={styles.ladderColumn}>
                      {DIAGNOSIS_LADDER_STATES.map((state) => {
                        const isActive = form.diagnosisLadder === state;
                        return (
                          <TouchableOpacity
                            key={state}
                            style={[
                              styles.optionButton,
                              styles.ladderOption,
                              isActive && styles.optionButtonActive,
                            ]}
                            accessibilityRole="radio"
                            accessibilityLabel={DIAGNOSIS_LADDER_LABELS[state]}
                            accessibilityState={{ selected: isActive }}
                            aria-checked={isActive}
                            onPress={() =>
                              setForm((prev) => ({
                                ...prev,
                                // Tapping the selected rung clears it,
                                // same as 当前行走 above — the five
                                // options have no 「不想说」 among them,
                                // and answering is not compulsory.
                                diagnosisLadder: prev.diagnosisLadder === state ? '' : state,
                              }))
                            }
                          >
                            {/* Deliberately not numberOfLines={1}: the
                                longest label is 12 characters and the
                                difference between 「已确诊，基因报告在
                                手上」 and 「已确诊，但报告不在手上」 is
                                the tail of the sentence. */}
                            <Text style={[styles.optionText, isActive && styles.optionTextActive]}>
                              {DIAGNOSIS_LADDER_LABELS[state]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.inputLabel}>确诊年份</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如：2022"
                      placeholderTextColor={COLOR.inkFaint}
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
                      placeholderTextColor={COLOR.inkFaint}
                      value={form.diagnosisType}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, diagnosisType: text }))}
                    />

                    <Text style={styles.inputLabel}>D4Z4 重复数（如有基因报告）</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如：4/22（报告识别有误时可在此修正）"
                      placeholderTextColor={COLOR.inkFaint}
                      value={form.d4z4}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, d4z4: text }))}
                    />

                    <Text style={styles.inputLabel}>首发部位</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="例如：肩胛带、面部、足背屈"
                      placeholderTextColor={COLOR.inkFaint}
                      value={form.onsetRegion}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, onsetRegion: text }))}
                    />

                    <Text style={styles.inputLabel}>家族史</Text>
                    <TextInput
                      style={[styles.input, styles.multilineInput]}
                      placeholder="例如：母亲疑似，家中暂无明确患者"
                      placeholderTextColor={COLOR.inkFaint}
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
                            accessibilityRole="radio"
                            accessibilityLabel={option.label}
                            accessibilityState={{ selected: isActive }}
                            aria-checked={isActive}
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
                            // Multi-select, unlike its two siblings above
                            // — checkbox, not radio.
                            accessibilityRole="checkbox"
                            accessibilityLabel={option}
                            accessibilityState={{ checked: isActive }}
                            aria-checked={isActive}
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
                      placeholderTextColor={COLOR.inkFaint}
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
                      placeholderTextColor={COLOR.inkFaint}
                      keyboardType="phone-pad"
                      value={form.contactPhone}
                      onChangeText={(text) => setForm((prev) => ({ ...prev, contactPhone: text }))}
                    />

                    <Text style={styles.inputLabel}>邮箱</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="请输入邮箱"
                      placeholderTextColor={COLOR.inkFaint}
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

              {/* This screen's one prominent action. It was a bare
                  TouchableOpacity with no accessibilityRole, and while
                  saving it replaced its label with a spinner — leaving a
                  control with neither a role nor a name at the exact
                  moment the user most needs to know what is happening.
                  Button carries the role, keeps the name through `busy`,
                  and announces aria-busy. */}
              <Button
                label="保存"
                variant="prominent"
                fullWidth
                busy={isSaving}
                onPress={handleSubmit}
              />
            </>
          )}
        </ScrollView>
      </View>
      <SensitiveDataConsentGate {...guardianGateProps} />
      <SensitiveDataConsentGate {...sensitiveGateProps} />
    </SafeAreaView>
  );
};

export default RegisterProfileScreen;

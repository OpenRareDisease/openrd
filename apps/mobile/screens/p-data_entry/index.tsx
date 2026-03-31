import { useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { LinearGradient } from 'expo-linear-gradient';
import {
  addDailyImpact,
  addFunctionTest,
  addFollowupEvent,
  addSymptomScore,
  createSubmission,
  getMyPatientProfile,
  type PatientProfile,
  uploadPatientDocument,
  upsertPatientProfile,
} from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS } from '../../lib/clinical-visuals';
import { getSessionValue, setSessionValue } from '../../lib/session-storage';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from './styles';

type EntryMode = 'followup' | 'event' | 'report';
type EventType =
  | 'fall'
  | 'new_foot_drop'
  | 'new_arm_raise_difficulty'
  | 'new_breathing_discomfort'
  | 'started_afo'
  | 'started_wheelchair'
  | 'started_niv'
  | 'other';
type Severity = 'mild' | 'moderate' | 'severe';

type UploadDraft = {
  name: string;
  title: string;
  file:
    | {
        uri: string;
        name: string;
        type: string;
      }
    | File
    | null;
};

type FollowupFormState = {
  stairClimbSeconds: string;
  sleepScore: string;
  fallCount: string;
};

type EventFormState = {
  eventType: EventType;
  severity: Severity;
  occurredAt: string;
  description: string;
};

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const DEFAULT_FOLLOWUP_FORM: FollowupFormState = {
  stairClimbSeconds: '',
  sleepScore: '6',
  fallCount: '0',
};

const DEFAULT_EVENT_FORM: EventFormState = {
  eventType: 'other',
  severity: 'moderate',
  occurredAt: todayIsoDate(),
  description: '',
};

const DEFAULT_UPLOAD_DRAFT: UploadDraft = {
  name: '',
  title: '',
  file: null,
};

const DATA_ENTRY_DRAFT_KEYS = {
  entryMode: 'openrd.dataEntry.entryMode',
  followup: 'openrd.dataEntry.followup',
  event: 'openrd.dataEntry.event',
} as const;

const modeCards: Array<{
  key: EntryMode;
  icon: ComponentProps<typeof FontAwesome6>['name'];
  order: string;
  eyebrow: string;
  title: string;
  description: string;
  cta: string;
}> = [
  {
    key: 'followup',
    icon: 'bolt',
    order: '01',
    eyebrow: 'FOLLOW-UP',
    title: '快速随访',
    description: '记录睡眠评分、10 级台阶用时和最近跌倒次数。',
    cta: '进入随访',
  },
  {
    key: 'event',
    icon: 'flag',
    order: '02',
    eyebrow: 'EVENT',
    title: '事件记录',
    description: '记录新问题和辅具、训练、用药等变化。',
    cta: '进入事件',
  },
  {
    key: 'report',
    icon: 'file-arrow-up',
    order: '03',
    eyebrow: 'REPORT',
    title: '报告上传',
    description: '上传检查报告，系统自动识别分类、日期和指标。',
    cta: '进入上传',
  },
];

const eventOptions: Array<{ key: EventType; label: string }> = [
  { key: 'fall', label: '跌倒' },
  { key: 'new_foot_drop', label: '新增足下垂' },
  { key: 'new_arm_raise_difficulty', label: '新增抬手困难' },
  { key: 'new_breathing_discomfort', label: '新增呼吸不适' },
  { key: 'started_afo', label: '开始使用 AFO' },
  { key: 'started_wheelchair', label: '开始使用轮椅' },
  { key: 'started_niv', label: '开始无创通气' },
  { key: 'other', label: '干预/用药变化 / 其他' },
];

const severityOptions: Array<{ key: Severity; label: string }> = [
  { key: 'mild', label: '轻' },
  { key: 'moderate', label: '中' },
  { key: 'severe', label: '重' },
];

const sleepScoreRangeHints = ['0-2 很差', '3-4 较差', '5-6 一般', '7-8 较好', '9-10 很好'];

const parseStoredDraft = async <T,>(key: string): Promise<Partial<T> | null> => {
  try {
    const raw = await getSessionValue(key);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as Partial<T>;
  } catch {
    return null;
  }
};

const persistDraft = async (key: string, value: unknown) => {
  try {
    await setSessionValue(key, JSON.stringify(value));
  } catch {
    // Draft persistence should never block data entry.
  }
};

const normalizeEntryMode = (value: string | null | undefined): EntryMode =>
  value === 'followup' || value === 'event' || value === 'report' ? value : 'followup';

const normalizeEventType = (value: string | null | undefined): EventType =>
  eventOptions.some((option) => option.key === value) ? (value as EventType) : 'other';

const normalizeSeverity = (value: string | null | undefined): Severity =>
  severityOptions.some((option) => option.key === value) ? (value as Severity) : 'moderate';

const normalizeIntegerText = (value: unknown, fallback = '0') => {
  const text = String(value ?? '')
    .replace(/[^\d]/g, '')
    .slice(0, 2);
  return text || fallback;
};

const sanitizeIntegerText = (value: string) => value.replace(/[^\d]/g, '').slice(0, 2);

const sanitizeDecimalText = (value: string) => {
  const normalized = value.replace(/[^\d.]/g, '');
  const parts = normalized.split('.');
  if (parts.length <= 1) {
    return normalized.slice(0, 5);
  }
  return `${parts[0].slice(0, 3)}.${parts.slice(1).join('').slice(0, 1)}`;
};

const normalizeDecimalText = (value: unknown) => {
  const text = sanitizeDecimalText(String(value ?? ''));
  if (!text) {
    return '';
  }
  const number = Number(text);
  if (Number.isNaN(number)) {
    return '';
  }
  return number.toFixed(text.includes('.') ? 1 : 0);
};

const normalizeSleepScore = (value: unknown) => {
  const numeric = Number(String(value ?? '').replace(/[^\d]/g, ''));
  if (Number.isNaN(numeric)) {
    return DEFAULT_FOLLOWUP_FORM.sleepScore;
  }
  return String(Math.min(10, Math.max(0, numeric)));
};

const getLatestSymptomValue = (profile: PatientProfile, symptomKey: string) =>
  profile.symptomScores.find((item) => item.symptomKey === symptomKey)?.score ?? null;

const getLatestFunctionTestValue = (profile: PatientProfile, testType: string) => {
  const item = profile.functionTests
    .filter((entry) => entry.testType === testType && entry.measuredValue !== null)
    .sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())[0];

  return item?.measuredValue ?? null;
};

const getLatestFallCount = (profile: PatientProfile) => {
  const item = profile.followupEvents.find((event) => event.eventType === 'fall');
  if (!item) {
    return null;
  }

  const matched = item.description?.match(/(\d+)/);
  if (matched?.[1]) {
    return matched[1];
  }

  if (item.severity === 'severe') return '3';
  if (item.severity === 'moderate') return '2';
  return '1';
};

const deriveFollowupForm = (profile: PatientProfile): Partial<FollowupFormState> => {
  const latestStairClimb = getLatestFunctionTestValue(profile, 'stair_climb');

  return {
    stairClimbSeconds: latestStairClimb !== null ? String(latestStairClimb) : '',
    sleepScore: normalizeSleepScore(getLatestSymptomValue(profile, 'sleep_quality')),
    fallCount: getLatestFallCount(profile) ?? DEFAULT_FOLLOWUP_FORM.fallCount,
  };
};

const deriveStairDifficultyLevel = (seconds: number) => {
  if (seconds <= 10) return 1;
  if (seconds <= 18) return 2;
  if (seconds <= 28) return 3;
  if (seconds <= 40) return 4;
  return 5;
};

const deriveEventForm = (profile: PatientProfile): Partial<EventFormState> => {
  const latestEvent = profile.followupEvents[0];
  if (!latestEvent) {
    return {};
  }

  return {
    eventType: normalizeEventType(latestEvent.eventType),
    severity: normalizeSeverity(latestEvent.severity),
    occurredAt: latestEvent.occurredAt?.slice(0, 10) || DEFAULT_EVENT_FORM.occurredAt,
    description: latestEvent.description ?? '',
  };
};

const renderSingleChoice = <T extends string>(
  label: string,
  value: T,
  options: Array<{ key: T; label: string }>,
  onChange: (next: T) => void,
) => (
  <View style={styles.fieldBlock}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={styles.choiceRow}>
      {options.map((option) => (
        <TouchableOpacity
          key={option.key}
          style={[styles.choiceChip, value === option.key && styles.choiceChipActive]}
          activeOpacity={0.88}
          onPress={() => onChange(option.key)}
        >
          <Text
            style={[styles.choiceChipText, value === option.key && styles.choiceChipTextActive]}
          >
            {option.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

const renderSleepScorePicker = (value: string, onChange: (next: string) => void) => (
  <View style={styles.scoreBlock}>
    <View style={styles.fieldHeaderRow}>
      <Text style={styles.fieldLabel}>最近一周睡眠质量评分</Text>
      <Text style={styles.fieldHint}>0 到 10 分</Text>
    </View>
    <Text style={styles.sectionSubtitle}>0 表示几乎没睡好，10 表示睡得很好且醒后比较恢复。</Text>
    <View style={styles.scoreRow}>
      {Array.from({ length: 11 }, (_, index) => {
        const active = value === String(index);
        return (
          <TouchableOpacity
            key={index}
            style={[styles.scoreChip, active && styles.scoreChipActive]}
            activeOpacity={0.88}
            onPress={() => onChange(String(index))}
          >
            <Text style={[styles.scoreChipText, active && styles.scoreChipTextActive]}>
              {index}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
    <View style={styles.scoreHintWrap}>
      {sleepScoreRangeHints.map((item) => (
        <View key={item} style={styles.scoreHintChip}>
          <Text style={styles.scoreHintText}>{item}</Text>
        </View>
      ))}
    </View>
  </View>
);

const DataEntryScreen = () => {
  const router = useRouter();
  const [entryMode, setEntryMode] = useState<EntryMode>('followup');
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraftsHydrated, setIsDraftsHydrated] = useState(false);
  const [followupForm, setFollowupForm] = useState<FollowupFormState>(DEFAULT_FOLLOWUP_FORM);
  const [eventForm, setEventForm] = useState<EventFormState>(DEFAULT_EVENT_FORM);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>(DEFAULT_UPLOAD_DRAFT);

  const loadContext = async () => {
    setIsLoading(true);
    setIsDraftsHydrated(false);

    try {
      const [savedFollowup, savedEvent, savedEntryMode] = await Promise.all([
        parseStoredDraft<FollowupFormState>(DATA_ENTRY_DRAFT_KEYS.followup),
        parseStoredDraft<EventFormState>(DATA_ENTRY_DRAFT_KEYS.event),
        getSessionValue(DATA_ENTRY_DRAFT_KEYS.entryMode),
      ]);

      setEntryMode(normalizeEntryMode(savedEntryMode));

      try {
        const profileData = await getMyPatientProfile();
        setProfile(profileData);
        const normalizedSavedFollowup = savedFollowup
          ? {
              stairClimbSeconds: normalizeDecimalText(
                (savedFollowup as Record<string, unknown>).stairClimbSeconds,
              ),
              sleepScore: normalizeSleepScore(
                (savedFollowup as Record<string, unknown>).sleepScore,
              ),
              fallCount: normalizeIntegerText(savedFollowup.fallCount, '0'),
            }
          : null;
        setFollowupForm({
          ...DEFAULT_FOLLOWUP_FORM,
          ...deriveFollowupForm(profileData),
          ...(normalizedSavedFollowup ?? {}),
        });
        setEventForm({
          ...DEFAULT_EVENT_FORM,
          ...deriveEventForm(profileData),
          ...(savedEvent
            ? {
                ...savedEvent,
                eventType: normalizeEventType(savedEvent.eventType),
                severity: normalizeSeverity(savedEvent.severity),
              }
            : {}),
        });
      } catch {
        setProfile(null);
        const normalizedSavedFollowup = savedFollowup
          ? {
              stairClimbSeconds: normalizeDecimalText(
                (savedFollowup as Record<string, unknown>).stairClimbSeconds,
              ),
              sleepScore: normalizeSleepScore(
                (savedFollowup as Record<string, unknown>).sleepScore,
              ),
              fallCount: normalizeIntegerText(savedFollowup.fallCount, '0'),
            }
          : null;
        setFollowupForm({
          ...DEFAULT_FOLLOWUP_FORM,
          ...(normalizedSavedFollowup ?? {}),
        });
        setEventForm({
          ...DEFAULT_EVENT_FORM,
          ...(savedEvent
            ? {
                ...savedEvent,
                eventType: normalizeEventType(savedEvent.eventType),
                severity: normalizeSeverity(savedEvent.severity),
              }
            : {}),
        });
      }

      setUploadDraft(DEFAULT_UPLOAD_DRAFT);
    } catch {
      setProfile(null);
    } finally {
      setIsDraftsHydrated(true);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadContext().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isDraftsHydrated) {
      return;
    }

    void setSessionValue(DATA_ENTRY_DRAFT_KEYS.entryMode, entryMode);
  }, [entryMode, isDraftsHydrated]);

  useEffect(() => {
    if (!isDraftsHydrated) {
      return;
    }

    void persistDraft(DATA_ENTRY_DRAFT_KEYS.followup, followupForm);
  }, [followupForm, isDraftsHydrated]);

  useEffect(() => {
    if (!isDraftsHydrated) {
      return;
    }

    void persistDraft(DATA_ENTRY_DRAFT_KEYS.event, eventForm);
  }, [eventForm, isDraftsHydrated]);

  const ensureProfileReady = async (fullName: string) => {
    if (profile) {
      return profile;
    }

    const created = (await upsertPatientProfile({
      fullName: fullName.trim() || 'FSHD 患者',
    })) as PatientProfile;
    setProfile(created);
    return created;
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0] as DocumentPicker.DocumentPickerAsset & {
      file?: File;
    };

    setUploadDraft((prev) => ({
      ...prev,
      name: asset.name,
      title: '',
      file:
        asset.file instanceof File
          ? asset.file
          : {
              uri: asset.uri,
              name: asset.name,
              type: asset.mimeType ?? 'application/octet-stream',
            },
    }));
  };

  const uploadDocument = async (submissionId?: string) => {
    if (!uploadDraft.file) {
      throw new Error('请先选择要上传的报告文件');
    }

    await uploadPatientDocument({
      documentType: 'other',
      title: uploadDraft.title.trim() || undefined,
      submissionId,
      file: uploadDraft.file,
    });
  };

  const resetUploadDraft = () => {
    setUploadDraft(DEFAULT_UPLOAD_DRAFT);
  };

  const handleFollowupSubmit = async () => {
    setIsSubmitting(true);

    try {
      const ensuredProfile = await ensureProfileReady(profile?.fullName ?? 'FSHD 患者');
      const stairClimbSeconds = Number(followupForm.stairClimbSeconds);
      const sleepScore = Number(followupForm.sleepScore);
      const fallCount = Number(followupForm.fallCount || '0');

      if (Number.isNaN(stairClimbSeconds) || stairClimbSeconds <= 0) {
        Alert.alert('请补充上楼计时', '请按“连续上 10 级台阶”的标准填写本次用时。');
        return;
      }

      if (Number.isNaN(sleepScore) || sleepScore < 0 || sleepScore > 10) {
        Alert.alert('请补充睡眠评分', '睡眠质量请按 0 到 10 分选择。');
        return;
      }

      if (Number.isNaN(fallCount) || fallCount < 0) {
        Alert.alert('请检查跌倒次数', '跌倒次数请填写 0 或更大的整数。');
        return;
      }

      const previousStairClimbSeconds = getLatestFunctionTestValue(
        profile ?? ensuredProfile,
        'stair_climb',
      );
      const previousSleepScore = getLatestSymptomValue(profile ?? ensuredProfile, 'sleep_quality');
      const hasChanges =
        fallCount > 0 ||
        (typeof previousStairClimbSeconds === 'number' &&
          Math.abs(previousStairClimbSeconds - stairClimbSeconds) >= 2) ||
        (typeof previousSleepScore === 'number' && Math.abs(previousSleepScore - sleepScore) >= 1);

      const summaryParts = [
        `睡眠评分 ${sleepScore}/10`,
        `10 级台阶用时 ${stairClimbSeconds.toFixed(1)} 秒`,
      ];

      if (fallCount > 0) {
        summaryParts.push(`最近跌倒 ${fallCount} 次`);
      } else {
        summaryParts.push('最近未记录跌倒');
      }

      const submission = await createSubmission({
        submissionKind: 'followup',
        summary: summaryParts.join('；'),
        changedSinceLast: hasChanges,
      });

      const requests: Array<Promise<unknown>> = [
        addSymptomScore({
          submissionId: submission.id,
          symptomKey: 'sleep_quality',
          score: sleepScore,
          scaleMin: 0,
          scaleMax: 10,
          notes: '0=很差，10=很好',
        }),
        addFunctionTest({
          submissionId: submission.id,
          testType: 'stair_climb',
          measuredValue: stairClimbSeconds,
          unit: 'sec',
          protocol: '连续上 10 级台阶',
          notes: '患者端快速随访量化记录',
        }),
        addDailyImpact({
          submissionId: submission.id,
          adlKey: 'stairs',
          difficultyLevel: deriveStairDifficultyLevel(stairClimbSeconds),
          notes: `标准：连续上 10 级台阶；本次用时 ${stairClimbSeconds.toFixed(1)} 秒`,
        }),
      ];

      if (fallCount > 0) {
        requests.push(
          addFollowupEvent({
            submissionId: submission.id,
            eventType: 'fall',
            severity: fallCount >= 3 ? 'severe' : fallCount >= 2 ? 'moderate' : 'mild',
            occurredAt: todayIsoDate(),
            description: `最近跌倒 ${fallCount} 次`,
          }),
        );
      }

      await Promise.all(requests);

      resetUploadDraft();
      setProfile(ensuredProfile);
      await loadContext();
      Alert.alert('已保存', '快速随访已完成。');
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof Error ? error.message : '随访保存失败';
      Alert.alert('保存失败', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEventSubmit = async () => {
    setIsSubmitting(true);

    try {
      await ensureProfileReady(profile?.fullName ?? 'FSHD 患者');
      const submission = await createSubmission({
        submissionKind: 'event',
        summary: eventOptions.find((item) => item.key === eventForm.eventType)?.label ?? '事件记录',
        changedSinceLast: true,
      });

      await Promise.all([
        addFollowupEvent({
          submissionId: submission.id,
          eventType: eventForm.eventType,
          severity: eventForm.severity,
          occurredAt: eventForm.occurredAt,
          description: eventForm.description || null,
        }),
      ]);

      resetUploadDraft();
      await loadContext();
      Alert.alert('已保存', '事件记录已添加。');
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof Error ? error.message : '事件保存失败';
      Alert.alert('保存失败', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReportSubmit = async () => {
    setIsSubmitting(true);

    try {
      await ensureProfileReady(profile?.fullName ?? 'FSHD 患者');
      const submission = await createSubmission({
        submissionKind: 'event',
        summary: uploadDraft.title.trim() || uploadDraft.name || '上传报告',
        changedSinceLast: false,
      });

      await uploadDocument(submission.id);

      resetUploadDraft();
      await loadContext();
      Alert.alert('已上传', '报告已上传，系统会自动识别报告类型和关键指标。');
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof Error ? error.message : '报告上传失败';
      Alert.alert('上传失败', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderUploadSection = () => (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>报告上传</Text>
      <Text style={styles.sectionSubtitle}>
        无需选择类别，系统会根据报告内容自动识别类型、报告时间和关键指标。
      </Text>

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>报告标题（可选）</Text>
        <TextInput
          value={uploadDraft.title}
          onChangeText={(value) => setUploadDraft((prev) => ({ ...prev, title: value }))}
          placeholder="可留空，系统会按识别结果展示名称"
          placeholderTextColor={CLINICAL_COLORS.textMuted}
          style={styles.input}
        />
      </View>

      <TouchableOpacity style={styles.uploadButton} activeOpacity={0.88} onPress={pickDocument}>
        <FontAwesome6 name="file-arrow-up" size={14} color={CLINICAL_COLORS.accentStrong} />
        <Text style={styles.uploadButtonText}>
          {uploadDraft.name ? `已选择：${uploadDraft.name}` : '选择 PDF、图片或其他文件'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  const renderFollowupForm = () => (
    <View style={styles.formStack}>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>量化随访</Text>
        <Text style={styles.sectionSubtitle}>
          这里直接记录患者端仍在持续追踪的量化数据；新问题、辅具、训练和用药变化请放到“事件记录”。
        </Text>
        <View style={styles.fieldBlock}>
          <View style={styles.fieldHeaderRow}>
            <Text style={styles.fieldLabel}>标准化上楼记录</Text>
            <Text style={styles.fieldHint}>连续上 10 级台阶</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            请填写这次完成 10
            级台阶所用的秒数；如果今天中途停顿、扶栏或无法完成，可在“事件记录”补充说明。
          </Text>
          <TextInput
            value={followupForm.stairClimbSeconds}
            onChangeText={(value) =>
              setFollowupForm((prev) => ({
                ...prev,
                stairClimbSeconds: sanitizeDecimalText(value),
              }))
            }
            placeholder="例如 18.5"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            keyboardType="decimal-pad"
            style={styles.input}
          />
          <View style={styles.scoreHintWrap}>
            {['≤10 秒 较轻松', '11-20 秒 一般', '21-30 秒 偏慢', '>30 秒 需关注'].map((item) => (
              <View key={item} style={styles.scoreHintChip}>
                <Text style={styles.scoreHintText}>{item}</Text>
              </View>
            ))}
          </View>
        </View>
        {renderSleepScorePicker(followupForm.sleepScore, (value) =>
          setFollowupForm((prev) => ({ ...prev, sleepScore: value })),
        )}
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>最近跌倒次数</Text>
          <Text style={styles.sectionSubtitle}>
            按最近一段时间内发生的实际跌倒次数填写；没有跌倒就填 0。
          </Text>
          <TextInput
            value={followupForm.fallCount}
            onChangeText={(value) =>
              setFollowupForm((prev) => ({
                ...prev,
                fallCount: sanitizeIntegerText(value),
              }))
            }
            placeholder="0"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            keyboardType="number-pad"
            style={styles.input}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        activeOpacity={0.88}
        disabled={isSubmitting}
        onPress={handleFollowupSubmit}
      >
        <Text style={styles.submitButtonText}>完成快速随访</Text>
      </TouchableOpacity>
    </View>
  );

  const renderReportForm = () => (
    <View style={styles.formStack}>
      {renderUploadSection()}

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>上传后会自动完成这些事</Text>
        <Text style={styles.sectionSubtitle}>
          系统会自动识别报告分类、提取日期和结构化指标，并在时间轴、报告管理和检查结果里更新展示。
        </Text>
        <View style={styles.tipList}>
          <View style={styles.tipItem}>
            <FontAwesome6 name="check" size={12} color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.tipText}>支持 PDF、拍照图片和常见文档文件</Text>
          </View>
          <View style={styles.tipItem}>
            <FontAwesome6 name="check" size={12} color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.tipText}>不需要患者手动选择报告类别</Text>
          </View>
          <View style={styles.tipItem}>
            <FontAwesome6 name="check" size={12} color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.tipText}>上传后可在“报告管理”里查看和删除</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        activeOpacity={0.88}
        disabled={isSubmitting}
        onPress={handleReportSubmit}
      >
        <Text style={styles.submitButtonText}>上传这份报告</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEventForm = () => (
    <View style={styles.formStack}>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>事件与干预记录</Text>
        <Text style={styles.sectionSubtitle}>
          辅具、训练、用药变化和补充说明都放在这里，不再和随访分开填。
        </Text>
        <View style={styles.choiceRow}>
          {eventOptions.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.choiceChip,
                eventForm.eventType === option.key && styles.choiceChipActive,
              ]}
              activeOpacity={0.88}
              onPress={() => setEventForm((prev) => ({ ...prev, eventType: option.key }))}
            >
              <Text
                style={[
                  styles.choiceChipText,
                  eventForm.eventType === option.key && styles.choiceChipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {renderSingleChoice('严重程度', eventForm.severity, severityOptions, (value) =>
          setEventForm((prev) => ({ ...prev, severity: value })),
        )}

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>发生日期</Text>
          <TextInput
            value={eventForm.occurredAt}
            onChangeText={(value) => setEventForm((prev) => ({ ...prev, occurredAt: value }))}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>发生了什么 / 这次做了什么调整</Text>
          <TextInput
            value={eventForm.description}
            onChangeText={(value) => setEventForm((prev) => ({ ...prev, description: value }))}
            placeholder="例如：开始使用 AFO，每周增加 2 次康复训练；这一周更容易绊脚"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        activeOpacity={0.88}
        disabled={isSubmitting}
        onPress={handleEventSubmit}
      >
        <Text style={styles.submitButtonText}>保存事件记录</Text>
      </TouchableOpacity>
    </View>
  );

  const activeModeCard = modeCards.find((item) => item.key === entryMode) ?? modeCards[0];

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={CLINICAL_GRADIENTS.page}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <ScreenBackButton fallbackHref="/p-home" />
              <View>
                <Text style={styles.eyebrow}>PATIENT ENTRY</Text>
                <Text style={styles.pageTitle}>患者自录与上传</Text>
              </View>
            </View>
          </View>

          <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
            <Text style={styles.heroTitle}>先选这次要完成的任务</Text>
            <Text style={styles.heroDescription}>
              选一个最符合这次目的的入口即可，填完后会自动更新时间轴、报告管理和检查结果。
            </Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaCard}>
                <Text style={styles.heroMetaValue}>{profile?.fullName ?? '未建档'}</Text>
                <Text style={styles.heroMetaLabel}>当前档案</Text>
              </View>
              <View style={styles.heroMetaCard}>
                <Text style={styles.heroMetaValue}>
                  {profile?.baseline ? '已完成' : '注册时补'}
                </Text>
                <Text style={styles.heroMetaLabel}>基础档案</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.modeSection}>
            <View style={styles.modeSectionHeader}>
              <View>
                <Text style={styles.modeSectionTitle}>选择本次任务</Text>
                <Text style={styles.modeSectionSubtitle}>
                  轻点下面任一入口，页面只展开当前对应的填写内容。
                </Text>
              </View>
              <View style={styles.modeSectionPill}>
                <Text style={styles.modeSectionPillText}>当前 {activeModeCard.order}</Text>
              </View>
            </View>

            <View style={styles.modeGrid}>
              {modeCards.map((item) => {
                const active = entryMode === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.modeCard, active && styles.modeCardActive]}
                    activeOpacity={0.9}
                    onPress={() => setEntryMode(item.key)}
                  >
                    <View style={styles.modeCardTopRow}>
                      <View style={styles.modeOrderWrap}>
                        <Text style={styles.modeOrderText}>{item.order}</Text>
                      </View>
                      <View
                        style={[styles.modeStatusBadge, active && styles.modeStatusBadgeActive]}
                      >
                        <Text
                          style={[
                            styles.modeStatusBadgeText,
                            active && styles.modeStatusBadgeTextActive,
                          ]}
                        >
                          {active ? '当前任务' : '可进入'}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.modeIconWrap}>
                      <FontAwesome6
                        name={item.icon}
                        size={18}
                        color={active ? CLINICAL_COLORS.accentStrong : CLINICAL_COLORS.textSoft}
                      />
                    </View>

                    <Text style={styles.modeEyebrow}>{item.eyebrow}</Text>
                    <Text style={styles.modeTitle}>{item.title}</Text>
                    <Text style={styles.modeDescription}>{item.description}</Text>

                    <View style={styles.modeFooter}>
                      <Text style={[styles.modeCtaText, active && styles.modeCtaTextActive]}>
                        {item.cta}
                      </Text>
                      <FontAwesome6
                        name="arrow-right"
                        size={12}
                        color={active ? CLINICAL_COLORS.accentStrong : CLINICAL_COLORS.textMuted}
                      />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.modeCurrentCard}>
              <Text style={styles.modeCurrentLabel}>当前已选择</Text>
              <Text style={styles.modeCurrentTitle}>{activeModeCard.title}</Text>
              <Text style={styles.modeCurrentText}>{activeModeCard.description}</Text>
            </View>
          </View>

          {entryMode === 'followup' ? renderFollowupForm() : null}
          {entryMode === 'event' ? renderEventForm() : null}
          {entryMode === 'report' ? renderReportForm() : null}
        </ScrollView>

        {(isLoading || isSubmitting) && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={CLINICAL_COLORS.accentStrong} />
            <Text style={styles.loadingText}>
              {isSubmitting ? '正在保存这次记录...' : '正在加载录入页面...'}
            </Text>
          </View>
        )}
      </LinearGradient>
    </SafeAreaView>
  );
};

export default DataEntryScreen;

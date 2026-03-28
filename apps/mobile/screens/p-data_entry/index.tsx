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
  addActivityLog,
  addDailyImpact,
  addFollowupEvent,
  addFunctionTest,
  addPatientMeasurement,
  addSymptomScore,
  createSubmission,
  getMyBaseline,
  getMyPatientProfile,
  type BaselineProfilePayload,
  type PatientProfile,
  updateMyBaseline,
  uploadPatientDocument,
  upsertPatientProfile,
} from '../../lib/api';
import { CLINICAL_COLORS, CLINICAL_GRADIENTS, CLINICAL_TINTS } from '../../lib/clinical-visuals';
import ScreenBackButton from '../common/ScreenBackButton';
import styles from './styles';

type EntryMode = 'baseline' | 'followup' | 'event';
type Feeling = 'better' | 'same' | 'worse';
type YesNo = 'yes' | 'no' | 'unknown';
type EventType =
  | 'fall'
  | 'new_foot_drop'
  | 'new_arm_raise_difficulty'
  | 'new_breathing_discomfort'
  | 'started_afo'
  | 'started_wheelchair'
  | 'started_niv'
  | 'uploaded_report'
  | 'other';
type Severity = 'mild' | 'moderate' | 'severe';

type UploadDraft = {
  name: string;
  title: string;
  documentType: 'mri' | 'genetic_report' | 'blood_panel' | 'other';
  file:
    | {
        uri: string;
        name: string;
        type: string;
      }
    | File
    | null;
};

const todayIsoDate = () => new Date().toISOString().slice(0, 10);

const modeCards: Array<{
  key: EntryMode;
  icon: ComponentProps<typeof FontAwesome6>['name'];
  title: string;
  description: string;
}> = [
  {
    key: 'baseline',
    icon: 'seedling',
    title: '基线建档',
    description: '第一次使用时建立疾病背景和当前状态。',
  },
  {
    key: 'followup',
    icon: 'bolt',
    title: '快速随访',
    description: '2 到 5 分钟记录“和上次相比有没有变化”。',
  },
  {
    key: 'event',
    icon: 'flag',
    title: '事件记录',
    description: '跌倒、足下垂、辅具变化或新报告单独登记。',
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
  { key: 'uploaded_report', label: '上传新报告' },
  { key: 'other', label: '其他事件' },
];

const yesNoOptions: Array<{ key: YesNo; label: string }> = [
  { key: 'yes', label: '有' },
  { key: 'no', label: '没有' },
  { key: 'unknown', label: '不确定' },
];

const feelingOptions: Array<{ key: Feeling; label: string }> = [
  { key: 'better', label: '更好' },
  { key: 'same', label: '差不多' },
  { key: 'worse', label: '更差' },
];

const severityOptions: Array<{ key: Severity; label: string }> = [
  { key: 'mild', label: '轻' },
  { key: 'moderate', label: '中' },
  { key: 'severe', label: '重' },
];

const documentTypeLabels: Record<UploadDraft['documentType'], string> = {
  mri: 'MRI',
  genetic_report: '基因',
  blood_panel: '血检/肺功',
  other: '其他',
};

const renderScoreChips = (
  label: string,
  value: number,
  onChange: (next: number) => void,
  max = 5,
  hint?: string,
) => (
  <View style={styles.scoreBlock}>
    <View style={styles.fieldHeaderRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldHint}>{hint ?? `${value}/${max}`}</Text>
    </View>
    <View style={styles.scoreRow}>
      {Array.from({ length: max + 1 }, (_, index) => (
        <TouchableOpacity
          key={`${label}-${index}`}
          style={[styles.scoreChip, value === index && styles.scoreChipActive]}
          activeOpacity={0.88}
          onPress={() => onChange(index)}
        >
          <Text style={[styles.scoreChipText, value === index && styles.scoreChipTextActive]}>
            {index}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  </View>
);

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

const DataEntryScreen = () => {
  const router = useRouter();
  const [entryMode, setEntryMode] = useState<EntryMode>('followup');
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [baselineForm, setBaselineForm] = useState({
    fullName: '',
    diagnosisYear: '',
    regionLabel: '',
    diagnosisType: '',
    onsetRegion: '',
    independentlyAmbulatory: 'yes' as YesNo,
    armRaiseDifficulty: 'unknown' as YesNo,
    footDrop: 'unknown' as YesNo,
    breathingSymptoms: 'unknown' as YesNo,
    fatigue: 2,
    pain: 1,
    stairs: 2,
    dressing: 1,
    reachingUp: 2,
    walkingStability: 2,
    notes: '',
  });

  const [followupForm, setFollowupForm] = useState({
    feeling: 'same' as Feeling,
    hasNewProblem: 'no' as YesNo,
    armRaiseLeft: 2,
    armRaiseRight: 2,
    walkingDifficulty: 2,
    stairsDifficulty: 2,
    footDropLeft: 1,
    footDropRight: 1,
    fatigue: 3,
    pain: 2,
    dyspnea: 1,
    sleepQuality: 7,
    tenMeterSeconds: '',
    fallCount: '0',
    interventionChange: '',
    note: '',
  });

  const [eventForm, setEventForm] = useState({
    eventType: 'fall' as EventType,
    severity: 'moderate' as Severity,
    occurredAt: todayIsoDate(),
    description: '',
  });

  const [uploadDraft, setUploadDraft] = useState<UploadDraft>({
    name: '',
    title: '',
    documentType: 'other',
    file: null,
  });

  const loadContext = async () => {
    setIsLoading(true);

    try {
      const profileData = await getMyPatientProfile();
      setProfile(profileData);

      try {
        const baseline = await getMyBaseline();
        const payload = baseline.baseline;
        setBaselineForm((prev) => ({
          ...prev,
          fullName: payload?.foundation?.fullName ?? profileData.fullName ?? prev.fullName,
          diagnosisYear:
            payload?.foundation?.diagnosisYear !== null &&
            payload?.foundation?.diagnosisYear !== undefined
              ? String(payload.foundation.diagnosisYear)
              : prev.diagnosisYear,
          regionLabel: payload?.foundation?.regionLabel ?? prev.regionLabel,
          diagnosisType: payload?.diseaseBackground?.diagnosisType ?? prev.diagnosisType,
          onsetRegion: payload?.diseaseBackground?.onsetRegion ?? prev.onsetRegion,
          independentlyAmbulatory:
            payload?.currentStatus?.independentlyAmbulatory === true
              ? 'yes'
              : payload?.currentStatus?.independentlyAmbulatory === false
                ? 'no'
                : prev.independentlyAmbulatory,
          armRaiseDifficulty:
            payload?.currentStatus?.armRaiseDifficulty === true
              ? 'yes'
              : payload?.currentStatus?.armRaiseDifficulty === false
                ? 'no'
                : prev.armRaiseDifficulty,
          footDrop:
            payload?.currentStatus?.footDrop === true
              ? 'yes'
              : payload?.currentStatus?.footDrop === false
                ? 'no'
                : prev.footDrop,
          breathingSymptoms:
            payload?.currentStatus?.breathingSymptoms === true
              ? 'yes'
              : payload?.currentStatus?.breathingSymptoms === false
                ? 'no'
                : prev.breathingSymptoms,
          fatigue: payload?.currentChallenges?.fatigue ?? prev.fatigue,
          pain: payload?.currentChallenges?.pain ?? prev.pain,
          stairs: payload?.currentChallenges?.stairs ?? prev.stairs,
          dressing: payload?.currentChallenges?.dressing ?? prev.dressing,
          reachingUp: payload?.currentChallenges?.reachingUp ?? prev.reachingUp,
          walkingStability: payload?.currentChallenges?.walkingStability ?? prev.walkingStability,
          notes: payload?.notes ?? prev.notes,
        }));
      } catch {
        setBaselineForm((prev) => ({
          ...prev,
          fullName: profileData.fullName ?? prev.fullName,
        }));
      }
    } catch {
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadContext().catch(() => undefined);
  }, []);

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
      title: prev.title || asset.name.replace(/\.[^.]+$/, ''),
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

  const maybeUploadDocument = async (submissionId: string) => {
    if (!uploadDraft.file) {
      return;
    }

    await uploadPatientDocument({
      documentType: uploadDraft.documentType,
      title: uploadDraft.title || uploadDraft.name,
      submissionId,
      file: uploadDraft.file,
    });
  };

  const resetUploadDraft = () => {
    setUploadDraft({
      name: '',
      title: '',
      documentType: 'other',
      file: null,
    });
  };

  const handleBaselineSubmit = async () => {
    setIsSubmitting(true);

    try {
      await ensureProfileReady(baselineForm.fullName);

      const summary = await createSubmission({
        submissionKind: 'baseline',
        summary: '完成基线建档',
        changedSinceLast: null,
      });

      const baselinePayload: BaselineProfilePayload = {
        foundation: {
          fullName: baselineForm.fullName || null,
          diagnosisYear: baselineForm.diagnosisYear ? Number(baselineForm.diagnosisYear) : null,
          regionLabel: baselineForm.regionLabel || null,
        },
        diseaseBackground: {
          diagnosisType: baselineForm.diagnosisType || null,
          onsetRegion: baselineForm.onsetRegion || null,
        },
        currentStatus: {
          independentlyAmbulatory:
            baselineForm.independentlyAmbulatory === 'yes'
              ? true
              : baselineForm.independentlyAmbulatory === 'no'
                ? false
                : null,
          armRaiseDifficulty:
            baselineForm.armRaiseDifficulty === 'yes'
              ? true
              : baselineForm.armRaiseDifficulty === 'no'
                ? false
                : null,
          footDrop:
            baselineForm.footDrop === 'yes' ? true : baselineForm.footDrop === 'no' ? false : null,
          breathingSymptoms:
            baselineForm.breathingSymptoms === 'yes'
              ? true
              : baselineForm.breathingSymptoms === 'no'
                ? false
                : null,
        },
        currentChallenges: {
          fatigue: baselineForm.fatigue,
          pain: baselineForm.pain,
          stairs: baselineForm.stairs,
          dressing: baselineForm.dressing,
          reachingUp: baselineForm.reachingUp,
          walkingStability: baselineForm.walkingStability,
        },
        notes: baselineForm.notes || null,
      };

      await updateMyBaseline(baselinePayload);
      await Promise.all([
        addSymptomScore({
          submissionId: summary.id,
          symptomKey: 'fatigue',
          score: baselineForm.fatigue,
          scaleMax: 5,
        }),
        addSymptomScore({
          submissionId: summary.id,
          symptomKey: 'pain',
          score: baselineForm.pain,
          scaleMax: 5,
        }),
        addDailyImpact({
          submissionId: summary.id,
          adlKey: 'stairs',
          difficultyLevel: baselineForm.stairs,
        }),
        addDailyImpact({
          submissionId: summary.id,
          adlKey: 'dressing',
          difficultyLevel: baselineForm.dressing,
        }),
        addDailyImpact({
          submissionId: summary.id,
          adlKey: 'reaching_up',
          difficultyLevel: baselineForm.reachingUp,
        }),
        addDailyImpact({
          submissionId: summary.id,
          adlKey: 'walking_outdoors',
          difficultyLevel: baselineForm.walkingStability,
        }),
        maybeUploadDocument(summary.id),
      ]);

      resetUploadDraft();
      await loadContext();
      Alert.alert('已保存', '基线建档已更新。');
      router.replace('/p-home');
    } catch (error) {
      const message = error instanceof Error ? error.message : '基线建档保存失败';
      Alert.alert('保存失败', message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFollowupSubmit = async () => {
    setIsSubmitting(true);

    try {
      const ensuredProfile = await ensureProfileReady(profile?.fullName ?? 'FSHD 患者');
      const hasChanges =
        followupForm.feeling !== 'same' ||
        followupForm.hasNewProblem === 'yes' ||
        Number(followupForm.fallCount || '0') > 0;

      const summaryText =
        followupForm.feeling === 'better'
          ? '最近整体感觉比上次更好'
          : followupForm.feeling === 'worse'
            ? '最近整体感觉比上次更差'
            : '最近整体感觉和上次差不多';

      const submission = await createSubmission({
        submissionKind: 'followup',
        summary: summaryText,
        changedSinceLast: hasChanges,
      });

      const requests: Array<Promise<unknown>> = [
        addPatientMeasurement({
          submissionId: submission.id,
          muscleGroup: 'deltoid',
          metricKey: 'arm_raise_over_head',
          bodyRegion: 'shoulder_girdle',
          side: 'left',
          strengthScore: Math.max(0, 5 - followupForm.armRaiseLeft),
          entryMode: 'self_report',
          notes: '患者自评左侧抬手困难程度',
        }),
        addPatientMeasurement({
          submissionId: submission.id,
          muscleGroup: 'deltoid',
          metricKey: 'arm_raise_over_head',
          bodyRegion: 'shoulder_girdle',
          side: 'right',
          strengthScore: Math.max(0, 5 - followupForm.armRaiseRight),
          entryMode: 'self_report',
          notes: '患者自评右侧抬手困难程度',
        }),
        addPatientMeasurement({
          submissionId: submission.id,
          muscleGroup: 'tibialis',
          metricKey: 'ankle_dorsiflexion',
          bodyRegion: 'ankle',
          side: 'left',
          strengthScore: Math.max(0, 5 - followupForm.footDropLeft),
          entryMode: 'self_report',
          notes: '患者自评左侧足下垂影响',
        }),
        addPatientMeasurement({
          submissionId: submission.id,
          muscleGroup: 'tibialis',
          metricKey: 'ankle_dorsiflexion',
          bodyRegion: 'ankle',
          side: 'right',
          strengthScore: Math.max(0, 5 - followupForm.footDropRight),
          entryMode: 'self_report',
          notes: '患者自评右侧足下垂影响',
        }),
        addSymptomScore({
          submissionId: submission.id,
          symptomKey: 'fatigue',
          score: followupForm.fatigue,
        }),
        addSymptomScore({
          submissionId: submission.id,
          symptomKey: 'pain',
          score: followupForm.pain,
        }),
        addSymptomScore({
          submissionId: submission.id,
          symptomKey: 'dyspnea',
          score: followupForm.dyspnea,
        }),
        addSymptomScore({
          submissionId: submission.id,
          symptomKey: 'sleep_quality',
          score: followupForm.sleepQuality,
        }),
        addDailyImpact({
          submissionId: submission.id,
          adlKey: 'reaching_up',
          difficultyLevel: Math.max(followupForm.armRaiseLeft, followupForm.armRaiseRight),
        }),
        addDailyImpact({
          submissionId: submission.id,
          adlKey: 'stairs',
          difficultyLevel: followupForm.stairsDifficulty,
        }),
        addDailyImpact({
          submissionId: submission.id,
          adlKey: 'walking_outdoors',
          difficultyLevel: followupForm.walkingDifficulty,
        }),
        maybeUploadDocument(submission.id),
      ];

      const walkSeconds = Number(followupForm.tenMeterSeconds);
      if (!Number.isNaN(walkSeconds) && walkSeconds > 0) {
        requests.push(
          addFunctionTest({
            submissionId: submission.id,
            testType: 'ten_meter_walk',
            measuredValue: walkSeconds,
            unit: 'seconds',
            notes: '患者自测 10 米步行',
          }),
        );
      }

      const fallCount = Number(followupForm.fallCount || '0');
      if (!Number.isNaN(fallCount) && fallCount > 0) {
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

      if (followupForm.interventionChange.trim()) {
        requests.push(
          addFollowupEvent({
            submissionId: submission.id,
            eventType: 'other',
            severity: 'moderate',
            occurredAt: todayIsoDate(),
            description: `干预/辅具变化：${followupForm.interventionChange.trim()}`,
          }),
        );
      }

      if (followupForm.note.trim()) {
        requests.push(
          addActivityLog({
            submissionId: submission.id,
            logDate: todayIsoDate(),
            source: 'manual',
            content: followupForm.note.trim(),
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
        maybeUploadDocument(submission.id),
      ]);

      resetUploadDraft();
      setEventForm({
        eventType: 'fall',
        severity: 'moderate',
        occurredAt: todayIsoDate(),
        description: '',
      });
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

  const renderUploadSection = () => (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionTitle}>可选上传报告</Text>
      <Text style={styles.sectionSubtitle}>
        报告是辅助信息源。提交后系统会把它和这次随访或事件放进同一条病程线。
      </Text>

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>报告类型</Text>
        <View style={styles.choiceRow}>
          {Object.entries(documentTypeLabels).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.choiceChip,
                uploadDraft.documentType === key && styles.choiceChipActive,
              ]}
              activeOpacity={0.88}
              onPress={() =>
                setUploadDraft((prev) => ({
                  ...prev,
                  documentType: key as UploadDraft['documentType'],
                }))
              }
            >
              <Text
                style={[
                  styles.choiceChipText,
                  uploadDraft.documentType === key && styles.choiceChipTextActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>报告标题</Text>
        <TextInput
          value={uploadDraft.title}
          onChangeText={(value) => setUploadDraft((prev) => ({ ...prev, title: value }))}
          placeholder="例如：2026-03 肺功能复查"
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

  const renderBaselineForm = () => (
    <View style={styles.formStack}>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>基础信息</Text>
        <Text style={styles.sectionSubtitle}>只填你现在愿意填的，后面都可以补。</Text>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>姓名或昵称</Text>
          <TextInput
            value={baselineForm.fullName}
            onChangeText={(value) => setBaselineForm((prev) => ({ ...prev, fullName: value }))}
            placeholder="例如：小李"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            style={styles.input}
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>确诊年份</Text>
            <TextInput
              value={baselineForm.diagnosisYear}
              onChangeText={(value) =>
                setBaselineForm((prev) => ({ ...prev, diagnosisYear: value.replace(/[^\d]/g, '') }))
              }
              placeholder="例如：2022"
              placeholderTextColor={CLINICAL_COLORS.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>所在地区</Text>
            <TextInput
              value={baselineForm.regionLabel}
              onChangeText={(value) => setBaselineForm((prev) => ({ ...prev, regionLabel: value }))}
              placeholder="例如：上海"
              placeholderTextColor={CLINICAL_COLORS.textMuted}
              style={styles.input}
            />
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>疾病背景</Text>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>分型或诊断方式</Text>
          <TextInput
            value={baselineForm.diagnosisType}
            onChangeText={(value) => setBaselineForm((prev) => ({ ...prev, diagnosisType: value }))}
            placeholder="例如：FSHD1"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            style={styles.input}
          />
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>你最早注意到哪里受影响</Text>
          <TextInput
            value={baselineForm.onsetRegion}
            onChangeText={(value) => setBaselineForm((prev) => ({ ...prev, onsetRegion: value }))}
            placeholder="例如：抬手、面部、上楼"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            style={styles.input}
          />
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>当前总体状态</Text>
        {renderSingleChoice(
          '目前能否独立行走',
          baselineForm.independentlyAmbulatory,
          yesNoOptions,
          (value) => setBaselineForm((prev) => ({ ...prev, independentlyAmbulatory: value })),
        )}
        {renderSingleChoice(
          '最近是否明显抬手困难',
          baselineForm.armRaiseDifficulty,
          yesNoOptions,
          (value) => setBaselineForm((prev) => ({ ...prev, armRaiseDifficulty: value })),
        )}
        {renderSingleChoice('是否有足下垂', baselineForm.footDrop, yesNoOptions, (value) =>
          setBaselineForm((prev) => ({ ...prev, footDrop: value })),
        )}
        {renderSingleChoice(
          '是否有气短或睡眠呼吸问题',
          baselineForm.breathingSymptoms,
          yesNoOptions,
          (value) => setBaselineForm((prev) => ({ ...prev, breathingSymptoms: value })),
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>当前困扰</Text>
        {renderScoreChips('疲劳', baselineForm.fatigue, (value) =>
          setBaselineForm((prev) => ({ ...prev, fatigue: value })),
        )}
        {renderScoreChips('疼痛', baselineForm.pain, (value) =>
          setBaselineForm((prev) => ({ ...prev, pain: value })),
        )}
        {renderScoreChips('上下楼', baselineForm.stairs, (value) =>
          setBaselineForm((prev) => ({ ...prev, stairs: value })),
        )}
        {renderScoreChips('穿脱衣', baselineForm.dressing, (value) =>
          setBaselineForm((prev) => ({ ...prev, dressing: value })),
        )}
        {renderScoreChips('抬手取物', baselineForm.reachingUp, (value) =>
          setBaselineForm((prev) => ({ ...prev, reachingUp: value })),
        )}
        {renderScoreChips('走路稳定性', baselineForm.walkingStability, (value) =>
          setBaselineForm((prev) => ({ ...prev, walkingStability: value })),
        )}

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>补充说明</Text>
          <TextInput
            value={baselineForm.notes}
            onChangeText={(value) => setBaselineForm((prev) => ({ ...prev, notes: value }))}
            placeholder="例如：右侧肩带比左侧明显更早受累"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>
      </View>

      {renderUploadSection()}

      <TouchableOpacity
        style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
        activeOpacity={0.88}
        disabled={isSubmitting}
        onPress={handleBaselineSubmit}
      >
        <Text style={styles.submitButtonText}>保存基线建档</Text>
      </TouchableOpacity>
    </View>
  );

  const renderFollowupForm = () => (
    <View style={styles.formStack}>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>先回答变化</Text>
        {renderSingleChoice(
          '今天和上次相比，整体感觉如何',
          followupForm.feeling,
          feelingOptions,
          (value) => setFollowupForm((prev) => ({ ...prev, feeling: value })),
        )}
        {renderSingleChoice(
          '这次是否有新问题需要记录',
          followupForm.hasNewProblem,
          yesNoOptions,
          (value) => setFollowupForm((prev) => ({ ...prev, hasNewProblem: value })),
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>核心功能域</Text>
        {renderScoreChips('左侧抬手困难', followupForm.armRaiseLeft, (value) =>
          setFollowupForm((prev) => ({ ...prev, armRaiseLeft: value })),
        )}
        {renderScoreChips('右侧抬手困难', followupForm.armRaiseRight, (value) =>
          setFollowupForm((prev) => ({ ...prev, armRaiseRight: value })),
        )}
        {renderScoreChips('走路更费力', followupForm.walkingDifficulty, (value) =>
          setFollowupForm((prev) => ({ ...prev, walkingDifficulty: value })),
        )}
        {renderScoreChips('上楼更困难', followupForm.stairsDifficulty, (value) =>
          setFollowupForm((prev) => ({ ...prev, stairsDifficulty: value })),
        )}
        {renderScoreChips('左侧足下垂影响', followupForm.footDropLeft, (value) =>
          setFollowupForm((prev) => ({ ...prev, footDropLeft: value })),
        )}
        {renderScoreChips('右侧足下垂影响', followupForm.footDropRight, (value) =>
          setFollowupForm((prev) => ({ ...prev, footDropRight: value })),
        )}
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>症状影响</Text>
        {renderScoreChips(
          '疲劳',
          followupForm.fatigue,
          (value) => setFollowupForm((prev) => ({ ...prev, fatigue: value })),
          10,
        )}
        {renderScoreChips(
          '疼痛',
          followupForm.pain,
          (value) => setFollowupForm((prev) => ({ ...prev, pain: value })),
          10,
        )}
        {renderScoreChips(
          '气短',
          followupForm.dyspnea,
          (value) => setFollowupForm((prev) => ({ ...prev, dyspnea: value })),
          10,
        )}
        {renderScoreChips(
          '睡眠质量',
          followupForm.sleepQuality,
          (value) => setFollowupForm((prev) => ({ ...prev, sleepQuality: value })),
          10,
        )}

        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>10 米步行耗时（秒，可跳过）</Text>
            <TextInput
              value={followupForm.tenMeterSeconds}
              onChangeText={(value) =>
                setFollowupForm((prev) => ({
                  ...prev,
                  tenMeterSeconds: value.replace(/[^\d.]/g, ''),
                }))
              }
              placeholder="例如：18.5"
              placeholderTextColor={CLINICAL_COLORS.textMuted}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.fieldLabel}>最近跌倒次数</Text>
            <TextInput
              value={followupForm.fallCount}
              onChangeText={(value) =>
                setFollowupForm((prev) => ({ ...prev, fallCount: value.replace(/[^\d]/g, '') }))
              }
              placeholder="0"
              placeholderTextColor={CLINICAL_COLORS.textMuted}
              keyboardType="number-pad"
              style={styles.input}
            />
          </View>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>干预与备注</Text>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>这次有没有新的辅具、训练或用药变化</Text>
          <TextInput
            value={followupForm.interventionChange}
            onChangeText={(value) =>
              setFollowupForm((prev) => ({ ...prev, interventionChange: value }))
            }
            placeholder="例如：开始使用 AFO，每周增加 2 次康复训练"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>补充说明</Text>
          <TextInput
            value={followupForm.note}
            onChangeText={(value) => setFollowupForm((prev) => ({ ...prev, note: value }))}
            placeholder="例如：下午明显更累，右脚容易绊地"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>
      </View>

      {renderUploadSection()}

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

  const renderEventForm = () => (
    <View style={styles.formStack}>
      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>事件类型</Text>
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
          <Text style={styles.fieldLabel}>发生了什么</Text>
          <TextInput
            value={eventForm.description}
            onChangeText={(value) => setEventForm((prev) => ({ ...prev, description: value }))}
            placeholder="例如：这一周开始更容易绊脚，右侧明显重于左侧"
            placeholderTextColor={CLINICAL_COLORS.textMuted}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>
      </View>

      {renderUploadSection()}

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
                <Text style={styles.pageTitle}>患者自录与随访</Text>
              </View>
            </View>
          </View>

          <LinearGradient colors={CLINICAL_GRADIENTS.surface} style={styles.heroCard}>
            <Text style={styles.heroTitle}>先选这次要完成的任务</Text>
            <Text style={styles.heroDescription}>
              不再按“报告 / 肌力 / 活动 /
              用药”堆表单。你只需要告诉系统，这次是建档、随访，还是记录一个新事件。
            </Text>
            <View style={styles.heroMetaRow}>
              <View style={styles.heroMetaCard}>
                <Text style={styles.heroMetaValue}>{profile?.fullName ?? '未建档'}</Text>
                <Text style={styles.heroMetaLabel}>当前档案</Text>
              </View>
              <View style={styles.heroMetaCard}>
                <Text style={styles.heroMetaValue}>{profile?.baseline ? '已完成' : '待补'}</Text>
                <Text style={styles.heroMetaLabel}>基线状态</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.modeGrid}>
            {modeCards.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.modeCard, entryMode === item.key && styles.modeCardActive]}
                activeOpacity={0.88}
                onPress={() => setEntryMode(item.key)}
              >
                <FontAwesome6
                  name={item.icon}
                  size={18}
                  color={
                    entryMode === item.key ? CLINICAL_COLORS.accentStrong : CLINICAL_COLORS.textSoft
                  }
                />
                <Text style={styles.modeTitle}>{item.title}</Text>
                <Text style={styles.modeDescription}>{item.description}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {entryMode === 'baseline' ? renderBaselineForm() : null}
          {entryMode === 'followup' ? renderFollowupForm() : null}
          {entryMode === 'event' ? renderEventForm() : null}
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

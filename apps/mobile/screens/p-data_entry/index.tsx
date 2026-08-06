import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TextInput, View } from 'react-native';
// Every control on this screen answers a press with geometry, not just
// a fade. See lib/press-scale.tsx: on the screen a patient uses daily,
// a press that produces no visible movement is the reason the next
// press happens.
import PressableScale from '../../lib/press-scale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { plainAnswerText } from '../common/answer-format';
import Button from '../common/Button';
import Icon from '../common/Icon';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  ApiError,
  addActivityLog,
  addDailyImpact,
  addFunctionTest,
  addFollowupEvent,
  addSymptomScore,
  createSubmission,
  draftLogEntry,
  getMyPatientProfile,
  isConsentRequiredError,
  type DocumentUploadFile,
  type PatientProfile,
  uploadPatientDocumentsSerially,
} from '../../lib/api';
import { COLOR } from '../../lib/design';
import { DATA_ENTRY_DRAFT_KEYS } from '../../lib/draft-keys';
import { getSessionValue, setSessionValue } from '../../lib/session-storage';
import { buildFollowupFeedback } from './followup-feedback';
import { SLEEP_BUCKETS, bucketForScore, stepSleepScore } from './sleep-score';
import InlineNotice from '../common/feedback/InlineNotice';
import { useAppDialog } from '../common/feedback/AppDialog';
import ScreenHeader from '../common/ScreenHeader';
import SensitiveDataConsentGate, {
  useSensitiveDataConsentGate,
} from '../p-privacy_settings/components/SensitiveDataConsentGate';
import styles from './styles';
import MuscleSelfTestForm from './MuscleSelfTestForm';
import InstrumentForm from './InstrumentForm';
import {
  FATIGUE_SCALE,
  PAIN_SCALE,
  SYMPTOM_GUIDELINE_NOTE,
  bucketForScoreIn,
  normalizeSymptomScore,
  stepSymptomScore,
  type SymptomScaleDefinition,
} from './symptom-scales';

type EntryMode = 'followup' | 'event' | 'report' | 'muscle' | 'instrument';
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

type UploadStatus = 'pending' | 'uploading' | 'success' | 'failed';

/** One picked file, waiting in the batch queue.
 *
 *  Status lives per row rather than per batch because a batch is
 *  exactly where "6 went through, the 7th didn't" happens, and the
 *  patient needs to see which one to re-take — not「上传失败」over the
 *  whole visit's worth of paperwork. */
type UploadItem = {
  /** Local row identity. Not the file name: a patient photographing
   *  five pages gets five IMG_0001.jpg-shaped names, and two of them
   *  really can collide. */
  key: string;
  name: string;
  /** null when the platform didn't report a size (some native
   *  DocumentPicker assets). The server's multer cap is the real gate;
   *  this only drives the pre-flight message. */
  sizeBytes: number | null;
  file: DocumentUploadFile;
  status: UploadStatus;
  error: string | null;
  documentId: string | null;
};

type UploadDraft = {
  title: string;
  items: UploadItem[];
  /** One submission per batch — a batch is one clinic visit, and seven
   *  submissions for one visit is seven timeline entries for something
   *  that happened once. Held so a per-row retry lands in the same
   *  visit instead of opening a new one. */
  submissionId: string | null;
};

type FollowupFormState = {
  stairClimbSeconds: string;
  sleepScore: string;
  fallCount: string;
  /** Optional free-text activity note — saved as an activity log
   *  alongside the followup when non-empty. */
  activityNote: string;
  /** 「今天做不了 / 不适用」for the timed stair climb.
   *
   *  Not a missing value: a blank field means "didn't record", this
   *  means "recorded, and the answer is 做不到" — opposite meanings in
   *  a progression trend. It saves a stair_climb row with a null
   *  measurement plus the `stairs` daily-impact at the top of the
   *  difficulty scale, so the day still appears in the record.
   *
   *  Without it the form was unsubmittable for anyone past stairs —
   *  the validator demanded seconds > 0 while the copy right above it
   *  said「无法完成」was fine — which locked the only daily-record
   *  entry point for exactly the patients whose decline matters most. */
  stairNotApplicable: boolean;
  /** Same idea for sleep. The field defaults to 6, so a patient who
   *  never touched it still shipped a "6/10" that reads downstream as
   *  a self-report; this records the abstention instead. */
  sleepNotApplicable: boolean;
  /** 疼痛 / 疲劳, 0-10, `''` while unanswered.
   *
   *  Unanswered on purpose — no default, and no「这次不评价」toggle to
   *  go with it. Sleep needed that toggle because it ships a 6 nobody
   *  chose; these two ship nothing until the patient taps a band, so
   *  the empty string IS the abstention and there is no second control
   *  to keep in sync with it. Nothing is written for an empty field;
   *  the submission summary records「未评价」so a blank does not read
   *  later as「不疼」.
   *
   *  Also never pre-filled from the last visit, unlike sleep and the
   *  stair time: last month's pain is not today's pain, and a
   *  pre-filled number that the patient leaves alone becomes a report
   *  they never made. */
  painScore: string;
  fatigueScore: string;
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
  activityNote: '',
  // Never pre-set from the profile, even when it says wheelchair: this
  // flag IS the record「今天做不了」, and a record the patient did not
  // make is a fabricated one. The profile only changes the wording of
  // the hint next to the toggle (see renderFollowupForm).
  stairNotApplicable: false,
  sleepNotApplicable: false,
  painScore: '',
  fatigueScore: '',
};

const DEFAULT_EVENT_FORM: EventFormState = {
  eventType: 'other',
  severity: 'moderate',
  occurredAt: todayIsoDate(),
  description: '',
};

/**
 *「今天做不了」travels as `notApplicable` on the stair-climb row
 * (migration 017) plus the `stairs` ADL at the top of its scale with
 * `needsAssistance`. The row is present with a null measurement, so a
 * trend can tell「做不到」from「没记」— which the interim version, a
 * sentence in `notes`, could not, because notes never reach the model.
 */

/**
 * Turn an upload failure into a sentence that tells the patient when
 * to come back.
 *
 * The OCR queue answers a full queue with 429 + `retryAfterSeconds`
 * (`profile.controller.ts` — the constant's own comment says it exists
 * so「the mobile batch uploader」can report a wait rather than a hard
 * failure). Dropping the number left the patient reading「识别队列已满，
 * 请稍后再试」directly above a retry button that was guaranteed to fail
 * again, because「稍后」is about a minute and nothing on screen said so.
 */
const describeUploadFailure = (error: Error | null | undefined): string => {
  if (!error) return '上传失败';
  const wait = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
  if (typeof wait === 'number' && wait > 0) {
    return `${error.message}（约 ${wait} 秒后可以重试）`;
  }
  return error.message || '上传失败';
};

const DEFAULT_UPLOAD_DRAFT: UploadDraft = {
  title: '',
  items: [],
  submissionId: null,
};

// Mirrors the API's multer cap (`profile.routes.ts` limits.fileSize =
// 10MB). Keep the two in sync — a larger value here just moves the
// failure to the end of the upload.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * How many files one batch may carry.
 *
 * Six, because that is roughly one clinic visit's paperwork (血常规 /
 * 生化 / 肌电图 / 心超 / 肺功能 / 基因报告) and because the cost of the
 * batch is not the upload — it is OCR, a local CPU-bound Python job at
 * 60-90 秒 per document, run serially (see
 * `uploadPatientDocumentsSerially`). Six is already 6-9 分钟 of
 * recognition queued behind one press. A larger cap would let a patient
 * queue half an hour of work with no way to tell how far it had got,
 * and would keep the box busy enough to slow everyone else's requests.
 *
 * The remedy when six is not enough is not a bigger number: it is
 * "upload these six, then come back", which the queue supports because
 * successful rows leave it and the picker reopens.
 */
const MAX_BATCH_FILES = 6;

/**
 * Total bytes per batch. Six phone photos of A4 paper run ~3-4MB each,
 * so 30MB fits a full batch of camera scans with headroom, while still
 * refusing six maxed-out 10MB PDFs (60MB) — which is not a suspicious
 * upload so much as ten minutes of a patient's mobile data.
 */
const MAX_BATCH_BYTES = 30 * 1024 * 1024;

const MAX_UPLOAD_LABEL = `${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB`;
const MAX_BATCH_LABEL = `${Math.floor(MAX_BATCH_BYTES / (1024 * 1024))}MB`;

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
};

let uploadKeySeed = 0;
const nextUploadKey = () => {
  uploadKeySeed += 1;
  return `upload-${uploadKeySeed}`;
};

type UploadCandidate = {
  name: string;
  sizeBytes: number | null;
  file: DocumentUploadFile;
};

/**
 * Decide which newly picked files join the queue.
 *
 * Pure and outside the component so the limits are one readable list
 * rather than three checks scattered across two pickers — and so the
 * refusals can name the file and the overshoot. 「上传失败」 tells a
 * patient holding seven scans nothing about which one to re-take or
 * what to do about it; 「「肌电图.pdf」12.4MB，比单份上限 10MB 多了
 * 2.4MB」 tells them both.
 */
const admitCandidates = (
  existing: UploadItem[],
  candidates: UploadCandidate[],
): { accepted: UploadItem[]; rejections: string[] } => {
  const accepted: UploadItem[] = [];
  const rejections: string[] = [];

  let count = existing.length;
  // Unknown sizes count as 0 here: the batch total is a courtesy check
  // (the per-file multer cap is the enforced one), and refusing a file
  // because the OS declined to report its size would block the upload
  // over a platform quirk the patient cannot do anything about.
  let totalBytes = existing.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);

  for (const candidate of candidates) {
    if (count >= MAX_BATCH_FILES) {
      rejections.push(
        `「${candidate.name}」这次没加进来：一次最多传 ${MAX_BATCH_FILES} 份，已经选满了。先把这 ${count} 份传完，再回来加剩下的。`,
      );
      continue;
    }

    if (candidate.sizeBytes !== null && candidate.sizeBytes > MAX_UPLOAD_BYTES) {
      rejections.push(
        `「${candidate.name}」${formatBytes(candidate.sizeBytes)}，比单份上限 ${MAX_UPLOAD_LABEL} 多了 ${formatBytes(
          candidate.sizeBytes - MAX_UPLOAD_BYTES,
        )}。可以分页拍照后分别上传，或先压缩再传。`,
      );
      continue;
    }

    const size = candidate.sizeBytes ?? 0;
    if (totalBytes + size > MAX_BATCH_BYTES) {
      rejections.push(
        `加上「${candidate.name}」这一批会有 ${formatBytes(totalBytes + size)}，比单批上限 ${MAX_BATCH_LABEL} 多了 ${formatBytes(
          totalBytes + size - MAX_BATCH_BYTES,
        )}。先上传已选的 ${count} 份，再回来传它。`,
      );
      continue;
    }

    count += 1;
    totalBytes += size;
    accepted.push({
      key: nextUploadKey(),
      name: candidate.name,
      sizeBytes: candidate.sizeBytes,
      file: candidate.file,
      status: 'pending',
      error: null,
      documentId: null,
    });
  }

  return { accepted, rejections };
};

// Keys live in lib/draft-keys.ts so logout can clear them without
// re-declaring the strings (see that file's header).

/**
 * The four entry points.
 *
 * They used to carry `order` (01-04) and an uppercase `eyebrow`
 * (FOLLOW-UP / EVENT / REPORT / MUSCLE) as well as a per-card `cta`.
 * All three are gone: the modes have no sequence — any one of them can
 * be opened at any time, so numbering them stated an order that does
 * not exist — the eyebrow was an English restatement of the Chinese
 * title on the next line, and the CTA repeated what tapping a row
 * obviously does.
 */
const modeCards: Array<{
  key: EntryMode;
  icon: string;
  title: string;
  description: string;
}> = [
  {
    key: 'followup',
    icon: 'bolt',
    title: '日常记录',
    description: '记录睡眠、疼痛、疲劳、10 级台阶用时和最近跌倒次数。',
  },
  {
    key: 'event',
    icon: 'flag',
    title: '事件记录',
    description: '记录新问题和辅具、训练、用药等变化。',
  },
  {
    key: 'report',
    icon: 'file-arrow-up',
    title: '报告上传',
    description: '上传检查报告，系统自动识别分类、日期和指标。',
  },
  {
    key: 'muscle',
    icon: 'hand-fist',
    title: '肌力自测',
    description: '5 个动作按 0-5 打分，自动汇入受累可视化。',
  },
  {
    key: 'instrument',
    // clipboard-list, not a new glyph: Icon.tsx warns loudly in dev for
    // an unmapped name and falls back to a bare circle in production,
    // and adding to that map is outside this change's files.
    icon: 'clipboard-list',
    title: '功能分级自评',
    description: '上肢 Brooke、下肢 Vignos 各选一句话，一分钟填完，会印在临床护照上。',
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
  value === 'followup' ||
  value === 'event' ||
  value === 'report' ||
  value === 'muscle' ||
  value === 'instrument'
    ? value
    : 'followup';

const normalizeEventType = (value: string | null | undefined): EventType =>
  eventOptions.some((option) => option.key === value) ? (value as EventType) : 'other';

const normalizeSeverity = (value: string | null | undefined): Severity =>
  severityOptions.some((option) => option.key === value) ? (value as Severity) : 'moderate';

/** Recognize-or-null, as opposed to the `normalize*` pair above.
 *
 *  Falling back to 其他/中 is right when rehydrating a persisted draft
 *  (some value must go in the state), and wrong for an AI draft, where
 *  the fallback would overwrite a type the patient chose by hand with
 *  one the model never said. Anything unrecognized here means "the
 *  model had no opinion", so the existing selection stands. */
const matchEventType = (value: string | null | undefined): EventType | null =>
  eventOptions.some((option) => option.key === value) ? (value as EventType) : null;

const matchSeverity = (value: string | null | undefined): Severity | null =>
  severityOptions.some((option) => option.key === value) ? (value as Severity) : null;

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

/** Re-normalize a followup draft coming back out of session storage.
 *
 *  Extracted because the profile-loaded and profile-unavailable paths
 *  in `loadContext` both need it and used to carry two hand-kept
 *  copies — a field added to one and forgotten in the other would come
 *  back unsanitized on whichever path the network happened to take. */
const normalizeSavedFollowup = (
  saved: Partial<FollowupFormState> | null,
): Partial<FollowupFormState> | null => {
  if (!saved) {
    return null;
  }

  const raw = saved as Record<string, unknown>;
  return {
    stairClimbSeconds: normalizeDecimalText(raw.stairClimbSeconds),
    sleepScore: normalizeSleepScore(raw.sleepScore),
    fallCount: normalizeIntegerText(raw.fallCount, '0'),
    activityNote: typeof raw.activityNote === 'string' ? raw.activityNote.slice(0, 200) : '',
    stairNotApplicable: raw.stairNotApplicable === true,
    sleepNotApplicable: raw.sleepNotApplicable === true,
    // normalizeSymptomScore returns '' for anything unusable, so a
    // corrupted draft comes back as「还没回答」rather than as a score.
    painScore: normalizeSymptomScore(raw.painScore),
    fatigueScore: normalizeSymptomScore(raw.fatigueScore),
  };
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
    // The previous event's `description` is deliberately NOT carried
    // over. A category and a date are defaults; free text is testimony
    // about a specific incident, and re-showing it in a blank new form
    // meant the next save could quietly duplicate last month's words
    // onto a different event — including one an AI draft had just
    // classified, which is how a hallucinated event ended up wearing a
    // real fall's description. The text is still in the archive.
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
        <PressableScale
          key={option.key}
          style={[styles.choiceChip, value === option.key && styles.choiceChipActive]}
          // The accessibility pass over choiceChip landed on three of
          // the five call sites in this file. This is the generic
          // helper, so it was the most-used one left announcing its
          // chips as plain text with no selected state.
          accessibilityRole="radio"
          accessibilityState={{ selected: value === option.key }}
          aria-checked={value === option.key}
          accessibilityLabel={option.label}
          onPress={() => onChange(option.key)}
        >
          <Text
            style={[styles.choiceChipText, value === option.key && styles.choiceChipTextActive]}
          >
            {option.label}
          </Text>
        </PressableScale>
      ))}
    </View>
  </View>
);

const renderSleepScorePicker = (opts: {
  value: string;
  notApplicable: boolean;
  onChange: (next: string) => void;
  onToggleNotApplicable: () => void;
}) => (
  <View style={styles.scoreBlock}>
    <View style={styles.fieldHeaderRow}>
      <Text style={styles.fieldLabel}>最近一周睡眠质量评分</Text>
      <Text style={styles.fieldHint}>0 到 10 分</Text>
    </View>
    <Text style={styles.sectionSubtitle}>0 表示几乎没睡好，10 表示睡得很好且醒后比较恢复。</Text>

    <View style={styles.choiceRow}>
      <PressableScale
        style={[styles.choiceChip, opts.notApplicable && styles.choiceChipActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: opts.notApplicable }}
        aria-selected={opts.notApplicable}
        accessibilityLabel="这次不评价睡眠"
        onPress={opts.onToggleNotApplicable}
      >
        <Text style={[styles.choiceChipText, opts.notApplicable && styles.choiceChipTextActive]}>
          这次不评价
        </Text>
      </PressableScale>
    </View>

    {opts.notApplicable ? (
      // The score defaults to 6, so leaving the picker on screen while
      // the entry skips it would show a number that is not going to be
      // saved. Say what happens instead.
      <Text style={styles.sectionSubtitle}>本次不记录睡眠评分，其余内容照常保存。</Text>
    ) : (
      <>
        <View style={styles.sleepBucketRow}>
          {SLEEP_BUCKETS.map((bucket) => {
            const score = Number(opts.value);
            const active = !Number.isNaN(score) && score >= bucket.min && score <= bucket.max;
            return (
              <PressableScale
                key={bucket.label}
                style={[styles.sleepBucket, active && styles.sleepBucketActive]}
                accessibilityRole="button"
                accessibilityState={active ? { selected: true } : {}}
                aria-selected={active}
                accessibilityLabel={`睡眠${bucket.label}，${bucket.min} 到 ${bucket.max} 分`}
                // Re-tapping the band you are already in is a no-op:
                // it would otherwise snap a value the patient had just
                // fine-tuned with the steppers back to `pick`, which
                // reads as the app undoing your work.
                onPress={() => {
                  if (!active) {
                    opts.onChange(String(bucket.pick));
                  }
                }}
              >
                <Text style={[styles.sleepBucketText, active && styles.sleepBucketTextActive]}>
                  {bucket.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        <View style={styles.sleepStepper}>
          <PressableScale
            style={styles.sleepStepButton}
            accessibilityRole="button"
            accessibilityLabel="睡眠评分减 1 分"
            onPress={() => opts.onChange(stepSleepScore(opts.value, -1))}
          >
            <Icon name="minus" size={16} color={COLOR.accent} />
          </PressableScale>

          <View style={styles.sleepValueWrap}>
            <Text style={styles.sleepValue}>{opts.value}</Text>
            <Text style={styles.sleepValueLabel}>
              分 · {bucketForScore(Number(opts.value) || 0).label}
            </Text>
          </View>

          <PressableScale
            style={styles.sleepStepButton}
            accessibilityRole="button"
            accessibilityLabel="睡眠评分加 1 分"
            onPress={() => opts.onChange(stepSleepScore(opts.value, 1))}
          >
            <Icon name="plus" size={16} color={COLOR.accent} />
          </PressableScale>
        </View>
      </>
    )}
  </View>
);

/**
 * 疼痛 / 疲劳 — the same bands-then-stepper control as sleep, with two
 * differences that matter.
 *
 *  - **It starts empty.** There is no default and no「这次不评价」chip.
 *    An untouched field saves nothing, and the confirmation says
 *   「未评价」rather than a number. Sleep needs its chip because its
 *    field ships a 6 nobody chose; this one has nothing to abstain from.
 *  - **The direction is printed.** Sleep runs 0=很差→10=很好 and these
 *    run 0=没有→10=最重. Two directions on one screen is how「今天不疼」
 *    gets recorded as a 10, so the direction sits above the control and
 *    the band label is repeated under the number.
 */
const renderSymptomScorePicker = (opts: {
  scale: SymptomScaleDefinition;
  value: string;
  onChange: (next: string) => void;
}) => {
  const hasValue = opts.value !== '';
  const numeric = Number(opts.value);
  const bucket =
    hasValue && Number.isFinite(numeric) ? bucketForScoreIn(opts.scale.buckets, numeric) : null;

  return (
    <View style={styles.scoreBlock}>
      <View style={styles.fieldHeaderRow}>
        <Text style={styles.fieldLabel}>{opts.scale.label}</Text>
        <Text style={styles.fieldHint}>0 到 10 分</Text>
      </View>
      <Text style={styles.sectionSubtitle}>{opts.scale.directionNote}</Text>

      <View style={styles.sleepBucketRow}>
        {opts.scale.buckets.map((candidate) => {
          const active =
            hasValue &&
            Number.isFinite(numeric) &&
            numeric >= candidate.min &&
            numeric <= candidate.max;
          return (
            <PressableScale
              key={candidate.label}
              style={[styles.sleepBucket, active && styles.sleepBucketActive]}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              aria-checked={active}
              accessibilityLabel={`${opts.scale.label}${candidate.label}，${candidate.min} 到 ${candidate.max} 分`}
              // Re-tapping the band you are already in is a no-op, as on
              // the sleep picker: it would otherwise snap a value the
              // patient had just nudged back to `pick`.
              onPress={() => {
                if (!active) {
                  opts.onChange(String(candidate.pick));
                }
              }}
            >
              <Text style={[styles.sleepBucketText, active && styles.sleepBucketTextActive]}>
                {candidate.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>

      <View style={styles.sleepStepper}>
        <PressableScale
          style={styles.sleepStepButton}
          accessibilityRole="button"
          accessibilityLabel={`${opts.scale.label}减 1 分`}
          onPress={() => opts.onChange(stepSymptomScore(opts.value, -1))}
        >
          <Icon name="minus" size={16} color={COLOR.accent} />
        </PressableScale>

        <View style={styles.sleepValueWrap}>
          {/* An em dash, not a 0: an unanswered field showing 0 would
              read as「一点都不疼」, which is a claim the patient has not
              made and the most consequential wrong answer this control
              can produce. */}
          <Text style={styles.sleepValue}>{hasValue ? opts.value : '—'}</Text>
          <Text style={styles.sleepValueLabel}>
            {bucket ? `分 · ${bucket.label}` : '还没评价，可以跳过'}
          </Text>
        </View>

        <PressableScale
          style={styles.sleepStepButton}
          accessibilityRole="button"
          accessibilityLabel={`${opts.scale.label}加 1 分`}
          onPress={() => opts.onChange(stepSymptomScore(opts.value, 1))}
        >
          <Icon name="plus" size={16} color={COLOR.accent} />
        </PressableScale>
      </View>
    </View>
  );
};

const DataEntryScreen = () => {
  const router = useRouter();
  // Replaces `Alert.alert`, which is an empty function on
  // react-native-web — i.e. every「已保存」on this screen was silent on
  // the platform this product actually ships (see AppDialog.tsx).
  const { notify } = useAppDialog();
  // PIPL Art. 29: health and genetic data need their OWN consent, not a
  // clause inside the general agreement accepted at registration. This
  // screen is the single place where such data first leaves the device,
  // so the gate lives on the upload path rather than in a settings
  // screen the patient may never open. It self-heals a lost
  // registration write too — the ledger is read here, not assumed.
  const { ensureSensitiveDataConsent, gateProps } = useSensitiveDataConsentGate();
  const [entryMode, setEntryMode] = useState<EntryMode>('followup');
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  /** True when the profile request failed for a reason other than 404.
   *  Without it, a network error and「还没建档」are the same `null`, and
   *  the header picked the second — telling a patient with a complete
   *  profile that they have none, with no error shown anywhere. */
  const [isProfileUnknown, setProfileUnknown] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDraftsHydrated, setIsDraftsHydrated] = useState(false);
  const [followupForm, setFollowupForm] = useState<FollowupFormState>(DEFAULT_FOLLOWUP_FORM);
  const [eventForm, setEventForm] = useState<EventFormState>(DEFAULT_EVENT_FORM);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft>(DEFAULT_UPLOAD_DRAFT);
  /** In-flight batch position, for「正在上传第 3 / 7 份」. Deliberately
   *  NOT `isSubmitting`: that raises the full-screen overlay, and a
   *  six-file batch can run for minutes — covering the queue is exactly
   *  the wrong thing to do while the queue is the progress display. */
  const [uploadRun, setUploadRun] = useState<{
    current: number;
    total: number;
    name: string;
  } | null>(null);
  // Recoverable failures render as an InlineNotice above the submit
  // button (three-way feedback split: no more blocking error popups);
  // per-field validation renders under its input.
  const [formNotice, setFormNotice] = useState<string | null>(null);
  // 说一句话: free text the AI turns into a pre-filled form. The draft
  // is never saved on its own — it lands in the same fields a manual
  // entry uses, and the patient presses save.
  const [speakText, setSpeakText] = useState('');
  const [speakBusy, setSpeakBusy] = useState(false);
  const [speakNotice, setSpeakNotice] = useState<string | null>(null);
  const [followupFieldErrors, setFollowupFieldErrors] = useState<{
    stairClimb?: string;
    sleep?: string;
    fall?: string;
  }>({});

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
        const normalizedSavedFollowup = normalizeSavedFollowup(savedFollowup);
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
      } catch (error) {
        setProfile(null);
        // 404 is a genuine「还没建档」; anything else is a failure the
        // header must not report as one. See headerProfileText.
        setProfileUnknown(!(error instanceof ApiError && error.status === 404));
        const normalizedSavedFollowup = normalizeSavedFollowup(savedFollowup);
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

      // The upload queue is deliberately NOT cleared here. loadContext
      // runs after every followup/event save too, and wiping a stack of
      // scans the patient had already picked — silently, because they
      // were on another tab — is the kind of thing that makes people
      // stop trusting the app with paperwork. Uploaded rows leave the
      // queue when they succeed; nothing else needs to reset it.
    } catch (error) {
      setProfile(null);
      setProfileUnknown(!(error instanceof ApiError && error.status === 404));
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

  /** The onboarding gate (app/_layout) guarantees a profile exists
   *  before this screen is reachable, so a missing profile here is a
   *  defensive edge (gate fail-open during a network blip). The old
   *  behavior — silently creating a profile named「FSHD 患者」— put
   *  fabricated names into medical records; erroring is honest. */
  /**
   * Preamble to every write this screen performs.
   *
   * The consent ask lives HERE rather than at each of the three submit
   * handlers because that is what makes it hold: this screen writes
   * measurements, function tests, symptom scores, daily impacts and
   * follow-up events, and the first version gated only the report
   * upload — so a patient who tapped 「暂不同意」 in the gate had the
   * rest of the form written to the server anyway, a second later. The
   * API refuses all of them without a ledger row
   * (requireSensitiveDataConsent), so a missed call here surfaces as a
   * 403 rather than as silent un-consented storage — but surfacing it
   * as a question is the point.
   *
   * Throws rather than returning a flag: every caller already runs
   * inside a try/catch that renders the message, and a boolean would
   * have to be checked at three sites, which is the shape that lets one
   * of them forget.
   */
  const ensureProfileReady = async () => {
    const consented = await ensureSensitiveDataConsent();
    if (!consented) {
      throw new Error('未记录敏感个人信息处理同意，本次记录没有保存。你可以稍后再来。');
    }
    if (profile) {
      return profile;
    }
    const refreshed = await getMyPatientProfile();
    if (refreshed) {
      setProfile(refreshed);
      return refreshed;
    }
    throw new Error('请先完成基础档案（“我的 → 编辑档案”），再记录数据。');
  };

  const uploadBusy = uploadRun !== null;
  const queuedCount = uploadDraft.items.length;
  const remainingSlots = Math.max(0, MAX_BATCH_FILES - queuedCount);

  /** Run the picked files past the limits and append what fits.
   *
   *  Pre-flight, not post-hoc: the API's multer cap rejects an
   *  oversized body anyway, but only after the patient has watched the
   *  whole thing crawl up a phone uplink. */
  const addCandidates = (candidates: UploadCandidate[]) => {
    const { accepted, rejections } = admitCandidates(uploadDraft.items, candidates);

    if (accepted.length > 0) {
      // Functional update so an in-flight batch's status changes are
      // not clobbered by the snapshot `admitCandidates` read.
      setUploadDraft((prev) => ({ ...prev, items: [...prev.items, ...accepted] }));
    }

    setFormNotice(rejections.length > 0 ? rejections.join('\n') : null);
  };

  const removeUploadItem = (key: string) => {
    setUploadDraft((prev) => ({ ...prev, items: prev.items.filter((item) => item.key !== key) }));
    setFormNotice(null);
  };

  const clearUploadQueue = () => {
    setUploadDraft((prev) => ({ ...prev, items: [], submissionId: null }));
    setFormNotice(null);
  };

  const pickDocuments = async () => {
    if (uploadBusy) return;
    if (remainingSlots === 0) {
      setFormNotice(
        `一次最多传 ${MAX_BATCH_FILES} 份，已经选满了。先上传这 ${queuedCount} 份，或移除其中几份再选。`,
      );
      return;
    }

    // The picker itself can reject (a denied storage permission, a
    // provider that dies mid-pick). Unhandled, that was an invisible
    // no-op: the sheet closed and nothing appeared in the list.
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: true,
        // Only formats the OCR pipeline can actually parse. Letting an
        // arbitrary file through meant the user waited out a full
        // upload+parse round trip just to learn it would fail.
        type: ['application/pdf', 'image/*'],
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const candidates = result.assets.map((entry) => {
        const asset = entry as DocumentPicker.DocumentPickerAsset & { file?: File };
        const webFile = asset.file instanceof File ? asset.file : null;
        return {
          name: asset.name,
          sizeBytes: webFile ? webFile.size : typeof asset.size === 'number' ? asset.size : null,
          file:
            webFile ??
            ({
              uri: asset.uri,
              name: asset.name,
              type: asset.mimeType ?? 'application/octet-stream',
            } as DocumentUploadFile),
        };
      });

      addCandidates(candidates);
    } catch (error) {
      setFormNotice(error instanceof Error ? error.message : '选择文件失败，请稍后重试');
    }
  };

  /** Camera / photo-library path. For a population with limited fine
   *  motor control, photographing the paper report is the lowest-effort
   *  way in — no file browsing.
   *
   *  It adds to the queue rather than uploading on the spot, which the
   *  single-file version did. That costs one press for a lone photo,
   *  and buys the thing the owner asked for: a patient back from a
   *  clinic visit photographs all seven sheets, checks the list, and
   *  presses upload once. An instant path that also had to append to a
   *  queue would be two different behaviours behind one button. */
  const pickImages = async (source: 'camera' | 'library') => {
    if (uploadBusy) return;
    if (remainingSlots === 0) {
      setFormNotice(
        `一次最多传 ${MAX_BATCH_FILES} 份，已经选满了。先上传这 ${queuedCount} 份，或移除其中几份再选。`,
      );
      return;
    }

    setFormNotice(null);

    try {
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setFormNotice('需要相机权限才能拍摄报告，可在系统设置中开启。');
          return;
        }
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.8,
              allowsMultipleSelection: true,
              // Stop the native picker at what is still free, so the
              // patient doesn't pick eight and then read about six.
              // Advisory only — iOS/Android honour it, web ignores it —
              // which is why `admitCandidates` is the real gate.
              selectionLimit: remainingSlots,
            });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const candidates: UploadCandidate[] = [];
      for (const asset of result.assets) {
        const mimeType = asset.mimeType ?? 'image/jpeg';
        // Web and the camera often report no file name. The fallback
        // carries the real extension (a PNG named .jpg confuses both
        // the OCR pipeline and the patient reading the list) and an
        // index, because Date.now() is identical for every asset in
        // one multi-select.
        const extension = mimeType.split('/')[1]?.split('+')[0] || 'jpg';
        const name = asset.fileName ?? `report-${Date.now()}-${candidates.length + 1}.${extension}`;

        if (Platform.OS === 'web') {
          // Browser FormData ignores the RN {uri,name,type} shape — the
          // multipart would land with no file part. Materialize a real
          // File from the blob:/data: URI (production ships as an Expo
          // web export, so this branch is load-bearing). Web assets
          // often omit fileSize, so the size comes off the blob.
          const blob = await (await fetch(asset.uri)).blob();
          candidates.push({
            name,
            sizeBytes: blob.size,
            file: new File([blob], name, { type: mimeType }),
          });
        } else {
          candidates.push({
            name,
            sizeBytes: typeof asset.fileSize === 'number' ? asset.fileSize : null,
            file: { uri: asset.uri, name, type: mimeType },
          });
        }
      }

      addCandidates(candidates);
    } catch (error) {
      const message = error instanceof Error ? error.message : '选择照片失败，请稍后重试';
      setFormNotice(message);
    }
  };

  const handleFollowupSubmit = async () => {
    // Collect EVERY failing field at once and render inline — the old
    // flow popped one blocking Alert per problem per submit.
    const { stairNotApplicable, sleepNotApplicable } = followupForm;
    const stairClimbSeconds = Number(followupForm.stairClimbSeconds);
    const sleepScore = Number(followupForm.sleepScore);
    const fallCount = Number(followupForm.fallCount || '0');
    // '' means「还没回答」. Not validated and never blocking: the
    // guideline says to ASK at every followup, not to make the rest of
    // the record unsubmittable until you answer.
    const painScore = Number(followupForm.painScore);
    const fatigueScore = Number(followupForm.fatigueScore);
    const painAnswered =
      followupForm.painScore !== '' &&
      Number.isFinite(painScore) &&
      painScore >= 0 &&
      painScore <= 10;
    const fatigueAnswered =
      followupForm.fatigueScore !== '' &&
      Number.isFinite(fatigueScore) &&
      fatigueScore >= 0 &&
      fatigueScore <= 10;

    const fieldErrors: typeof followupFieldErrors = {};
    // A field marked「今天做不了」has been answered, not skipped.
    // Validating it as a number anyway is what made this whole screen
    // unsubmittable for patients past stairs — the one group whose
    // record we least want to go blank.
    if (!stairNotApplicable && (Number.isNaN(stairClimbSeconds) || stairClimbSeconds <= 0)) {
      fieldErrors.stairClimb = '请按“连续上 10 级台阶”的标准填写本次用时，或标记“今天做不了”。';
    }
    if (!sleepNotApplicable && (Number.isNaN(sleepScore) || sleepScore < 0 || sleepScore > 10)) {
      fieldErrors.sleep = '睡眠质量请按 0 到 10 分选择。';
    }
    if (Number.isNaN(fallCount) || fallCount < 0) {
      fieldErrors.fall = '跌倒次数请填写 0 或更大的整数。';
    }
    setFollowupFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    setFormNotice(null);
    setIsSubmitting(true);

    try {
      const ensuredProfile = await ensureProfileReady();

      const previousStairClimbSeconds = getLatestFunctionTestValue(
        profile ?? ensuredProfile,
        'stair_climb',
      );
      const previousSleepScore = getLatestSymptomValue(profile ?? ensuredProfile, 'sleep_quality');
      const previousPainScore = getLatestSymptomValue(profile ?? ensuredProfile, PAIN_SCALE.key);
      const previousFatigueScore = getLatestSymptomValue(
        profile ?? ensuredProfile,
        FATIGUE_SCALE.key,
      );
      const hasChanges =
        fallCount > 0 ||
        // 2 points on a 0-10 NRS, not 1: pain and fatigue are noisier
        // day to day than sleep, and flagging every 1-point wobble as
        //「有变化」would make the flag mean nothing.
        (painAnswered &&
          typeof previousPainScore === 'number' &&
          Math.abs(previousPainScore - painScore) >= 2) ||
        (fatigueAnswered &&
          typeof previousFatigueScore === 'number' &&
          Math.abs(previousFatigueScore - fatigueScore) >= 2) ||
        // 能做 → 做不了 is the largest change this form can carry, and
        // the only one with no numeric delta to threshold.
        (stairNotApplicable && typeof previousStairClimbSeconds === 'number') ||
        (!stairNotApplicable &&
          typeof previousStairClimbSeconds === 'number' &&
          Math.abs(previousStairClimbSeconds - stairClimbSeconds) >= 2) ||
        (!sleepNotApplicable &&
          typeof previousSleepScore === 'number' &&
          Math.abs(previousSleepScore - sleepScore) >= 1);

      const summaryParts = [
        sleepNotApplicable ? '睡眠评分：本次未评价' : `睡眠评分 ${sleepScore}/10`,
        // Always in the summary, answered or not. A followup that says
        // nothing about pain reads later as「没问」— which is exactly
        // the state the 2010 ENMC consensus asks this form to leave
        // behind (see symptom-scales.ts).
        painAnswered ? `疼痛 ${painScore}/10` : '疼痛：本次未评价',
        fatigueAnswered ? `疲劳 ${fatigueScore}/10` : '疲劳：本次未评价',
        stairNotApplicable
          ? '10 级台阶：本次无法完成'
          : `10 级台阶用时 ${stairClimbSeconds.toFixed(1)} 秒`,
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

      const activityNote = followupForm.activityNote.trim();
      const requests: Array<Promise<unknown>> = [];

      // No symptom-score row at all when the patient declined to rate
      // sleep: the scale has no "not rated" value (the API requires a
      // 0-10 integer), and posting the form's default 6 would put a
      // number nobody chose into the trend. The abstention is carried
      // by the submission summary instead.
      if (!sleepNotApplicable) {
        requests.push(
          addSymptomScore({
            submissionId: submission.id,
            symptomKey: 'sleep_quality',
            score: sleepScore,
            scaleMin: 0,
            scaleMax: 10,
            notes: '0=很差，10=很好',
          }),
        );
      }

      // Same contract as sleep: a row only exists when the patient gave
      // a number. `patient_symptom_scores` has no「未评价」value, and
      // posting a 0 for an untouched pain field would write「一点都不疼」
      // into a trend a clinician reads.
      if (painAnswered) {
        requests.push(
          addSymptomScore({
            submissionId: submission.id,
            symptomKey: PAIN_SCALE.key,
            score: painScore,
            scaleMin: 0,
            scaleMax: 10,
            notes: PAIN_SCALE.storedNote,
          }),
        );
      }

      if (fatigueAnswered) {
        requests.push(
          addSymptomScore({
            submissionId: submission.id,
            symptomKey: FATIGUE_SCALE.key,
            score: fatigueScore,
            scaleMin: 0,
            scaleMax: 10,
            notes: FATIGUE_SCALE.storedNote,
          }),
        );
      }

      requests.push(
        // 做不了 is still a stair-climb record — it just has no seconds.
        // The row exists so the day is present in the history (a blank
        // day means "didn't record"), while the null measurement keeps
        // it out of the timed trend, where a fabricated number would be
        // read as a real climb.
        addFunctionTest({
          submissionId: submission.id,
          testType: 'stair_climb',
          measuredValue: stairNotApplicable ? null : stairClimbSeconds,
          // The typed carrier for「今天做不了」. Before migration 017
          // this meaning lived in `notes`, which the AI retriever
          // deliberately never reads — so the one consumer that most
          // needed the distinction was the one that could not see it.
          notApplicable: stairNotApplicable,
          unit: stairNotApplicable ? null : 'sec',
          protocol: '连续上 10 级台阶',
          notes: '患者端快速日常记录',
        }),
        addDailyImpact({
          submissionId: submission.id,
          adlKey: 'stairs',
          // The 0-5 ADL scale is the closest typed home this API has
          // for「做不到」: 5 is its ceiling, and `needsAssistance` says
          // the patient cannot do this alone. It is not a perfect fit —
          // 5 also means "slower than 40 秒" — so the note carries the
          // distinction a reader (or a future column) needs.
          difficultyLevel: stairNotApplicable ? 5 : deriveStairDifficultyLevel(stairClimbSeconds),
          needsAssistance: stairNotApplicable ? true : undefined,
          notes: stairNotApplicable
            ? '标准：连续上 10 级台阶；本次患者标记为无法完成'
            : `标准：连续上 10 级台阶；本次用时 ${stairClimbSeconds.toFixed(1)} 秒`,
        }),
      );

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

      if (activityNote) {
        requests.push(
          addActivityLog({
            submissionId: submission.id,
            source: 'manual',
            logDate: todayIsoDate(),
            content: activityNote,
          }),
        );
      }

      await Promise.all(requests);

      // Clear the submitted draft BEFORE reloading, so loadContext
      // re-derives the form from the (now fresher) profile instead of
      // resurrecting the just-submitted values from session storage.
      await setSessionValue(DATA_ENTRY_DRAFT_KEYS.followup, null);
      setProfile(ensuredProfile);
      await loadContext();
      // Instant payback: compare against the record that was current
      // BEFORE this save (previousStairClimbSeconds/previousSleepScore
      // were derived above, pre-submit), so every entry immediately
      // shows the patient something about their own trend.
      const totalRecords =
        (ensuredProfile.functionTests?.filter((t) => t.testType === 'stair_climb').length ?? 0) + 1;
      // buildFollowupFeedback's whole output is a comparison of two
      // stair times. There is no comparison to make when this entry
      // says 做不了, and phrasing it as「比上次慢」would report a
      // measurement that was never taken as a worse one. Confirm what
      // was recorded instead — and say plainly that it counts, because
      // the patient just told the app about their worst day.
      const feedback = stairNotApplicable
        ? [
            '已记录“今天上不了 10 级台阶”。这是一条数据，不是空白——趋势里看得到。',
            `已累计 ${totalRecords} 次日常记录，坚持记录能让趋势更可信。`,
          ].join('\n')
        : buildFollowupFeedback({
            stairClimbSeconds,
            previousStairClimbSeconds:
              typeof previousStairClimbSeconds === 'number' ? previousStairClimbSeconds : null,
            sleepScore,
            // Suppresses the sleep line: with no score submitted there
            // is nothing to compare it against.
            previousSleepScore:
              !sleepNotApplicable && typeof previousSleepScore === 'number'
                ? previousSleepScore
                : null,
            totalRecords,
          });
      // What actually landed in the record, in the same words the
      // submission summary uses.「已保存」on its own leaves the patient
      // guessing whether the 活动 line made it in, or whether the
      // 「今天做不了」mark counted as a record at all.
      const savedSummary = `本次存入：${[
        ...summaryParts,
        activityNote ? `活动记录「${activityNote}」` : null,
      ]
        .filter(Boolean)
        .join('；')}`;

      // Stay on this screen: users backfilling several records used to
      // get bounced to the home screen after every single save.
      //
      // notify(), not Alert.alert(): on web the latter is an empty
      // function, so the owner pressing 完成今日记录 saw nothing happen
      // at all — the single most common action in the app, silently.
      // The dismiss button is「知道了」and it stays here, which is the
      // old「继续记录」without spending a second button on it.
      notify({
        title: '已保存今日记录',
        message: [savedSummary, '', feedback, '', '表单已按最新档案刷新，可以接着记下一条。'].join(
          '\n',
        ),
        tone: 'success',
        action: { label: '查看我的档案', onPress: () => router.push('/p-archive') },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '日常记录保存失败';
      // Both, on purpose: the dialog is unmissable at the moment of
      // failure (an inline notice can be off-screen on a long form),
      // and the inline copy survives dismissing it, so the patient can
      // still read what went wrong while fixing it.
      setFormNotice(message);
      notify({ title: '这次没保存成功', message, tone: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Turn one sentence into pre-filled fields.
   *
   * The AI's whole job here is the classification the old four-card
   * grid pushed onto the patient: is「今天上楼特别费劲，还差点摔了」a
   * followup, an event, or both. It answers that and fills the numbers
   * it heard — then gets out of the way. Nothing is saved: the patient
   * lands in the ordinary form, checks it, and presses save, so every
   * write still goes through the same validated path a hand-typed
   * entry does.
   */
  const handleDraftFromSpeech = async () => {
    const text = speakText.trim();
    if (!text || speakBusy) return;

    setSpeakBusy(true);
    setSpeakNotice(null);
    setFormNotice(null);

    try {
      const draft = await draftLogEntry(text);

      if (!draft.followup && !draft.event) {
        setSpeakNotice('没听出可以记录的内容，换个说法，或直接在下面手动填。');
        return;
      }

      if (draft.followup) {
        const drafted = draft.followup;
        setFollowupForm((prev) => ({
          ...prev,
          stairClimbSeconds:
            drafted.stairClimbSeconds != null
              ? String(drafted.stairClimbSeconds)
              : prev.stairClimbSeconds,
          // A time the model actually heard contradicts a standing
          // 「今天做不了」mark; the number wins, and the mark clears so
          // the two can't disagree in the same submission.
          stairNotApplicable: drafted.stairClimbSeconds != null ? false : prev.stairNotApplicable,
          sleepScore: drafted.sleepScore != null ? String(drafted.sleepScore) : prev.sleepScore,
          sleepNotApplicable: drafted.sleepScore != null ? false : prev.sleepNotApplicable,
          fallCount: drafted.fallCount != null ? String(drafted.fallCount) : prev.fallCount,
          activityNote: drafted.activityNote?.trim() || prev.activityNote,
        }));
      }

      if (draft.event) {
        const drafted = draft.event;
        // Every field here is "overwrite only if the model said
        // something". It used to be unconditional for the two enums,
        // and because the server bottomed them out at 其他/中, a
        // patient who had hand-picked 跌倒/重 watched it silently
        // become 其他/中 with no undo — and the sentence that produced
        // it was cleared, so it could not even be re-drafted. The
        // server now returns null for "not heard"; `matchEventType`
        // treats an unrecognized value the same way.
        const draftedType = matchEventType(drafted.eventType);
        const draftedSeverity = matchSeverity(drafted.severity);
        setEventForm((prev) => ({
          ...prev,
          eventType: draftedType ?? prev.eventType,
          severity: draftedSeverity ?? prev.severity,
          occurredAt: drafted.occurredAt || prev.occurredAt,
          description: drafted.description?.trim() || prev.description,
        }));
      }

      // Land on the rarer, more consequential form when the sentence
      // produced both — an event is the thing worth eyeballing first.
      setEntryMode(draft.event ? 'event' : 'followup');

      // The model restates the patient's own sentence here, and the
      // notice that carries it is a bare <Text>. `**` and `- ` from a
      // model that ignored the plain-text instruction would land
      // inside the quotation marks, so the syntax is stripped rather
      // than trusted.
      const understanding = draft.understanding
        ? `理解为「${plainAnswerText(draft.understanding)}」。`
        : '';
      setSpeakNotice(
        (draft.followup && draft.event
          ? `${understanding}整理成 2 条：日常记录和事件记录都已填好，请分别核对并保存。`
          : `${understanding}已填好下面的表单，核对无误后保存。`) +
          '\n你说的原话还留在上面的输入框里，整理得不对可以改一改再整理一次。',
      );
      // The sentence is deliberately NOT cleared. It is the only copy
      // of what the patient said, and typing it again is expensive for
      // these hands; clearing it made a wrong draft unrecoverable, with
      // no undo on the fields it had already overwritten.
    } catch (error) {
      setSpeakNotice(
        isConsentRequiredError(error)
          ? '需要先在「我的 › 隐私设置」里同意 AI 使用你的数据，也可以直接手动填。'
          : error instanceof Error
            ? error.message
            : 'AI 暂时整理不了，你可以直接手动填写。',
      );
    } finally {
      setSpeakBusy(false);
    }
  };

  const handleEventSubmit = async () => {
    setIsSubmitting(true);

    const eventLabel =
      eventOptions.find((item) => item.key === eventForm.eventType)?.label ?? '事件记录';
    const severityLabel =
      severityOptions.find((item) => item.key === eventForm.severity)?.label ?? '中';
    const savedDescription = eventForm.description.trim();
    const savedOccurredAt = eventForm.occurredAt;

    try {
      await ensureProfileReady();
      const submission = await createSubmission({
        submissionKind: 'event',
        summary: eventLabel,
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

      await setSessionValue(DATA_ENTRY_DRAFT_KEYS.event, null);
      await loadContext();
      // loadContext re-derives the event form from the profile, which
      // back-fills the event JUST submitted (type/severity/description
      // included) — a duplicate-submission trap now that we stay on
      // this screen. Start the next entry from a clean slate instead.
      setEventForm({ ...DEFAULT_EVENT_FORM, occurredAt: todayIsoDate() });
      // Name the event that was stored, not just「已保存」: the form is
      // blank again by the time this shows, so the only way the patient
      // can tell the right thing was recorded is if it says so.
      notify({
        title: '已保存事件记录',
        message: [
          `本次存入：${eventLabel}（${severityLabel}），发生日期 ${savedOccurredAt}。`,
          savedDescription ? `说明：${savedDescription}` : '未填写补充说明。',
          '',
          '表单已清空，可以接着记下一件事。',
        ].join('\n'),
        tone: 'success',
        action: { label: '查看我的档案', onPress: () => router.push('/p-archive') },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '事件保存失败';
      setFormNotice(message);
      notify({ title: '这次没保存成功', message, tone: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Upload the queue — or one row of it, for a retry.
   *
   * Serial by construction (see `uploadPatientDocumentsSerially`), and
   * per-row in its reporting: the whole point of a batch is that a
   * patient back from a clinic visit uploads seven sheets at once, and
   * the seventh failing must not throw away the six that went through.
   */
  const runUploadBatch = async (targetKeys?: string[]) => {
    if (uploadBusy || isSubmitting) return;

    const queue = uploadDraft.items.filter(
      (item) => item.status !== 'success' && (!targetKeys || targetKeys.includes(item.key)),
    );

    if (queue.length === 0) {
      setFormNotice('请先选择要上传的报告，可以一次选多份。');
      return;
    }

    setFormNotice(null);

    // The ask itself now lives in ensureProfileReady, which every write
    // path goes through — but it has to happen BEFORE setUploadRun
    // paints a progress row, and before createSubmission persists the
    // intent to upload. So it stays explicit here and the call inside
    // ensureProfileReady short-circuits on the hook's own grant flag.
    const consented = await ensureSensitiveDataConsent();
    if (!consented) {
      setFormNotice('未记录敏感信息处理同意，报告没有上传。你可以稍后再来。');
      return;
    }

    const total = queue.length;
    setUploadRun({ current: 1, total, name: queue[0].name });

    try {
      await ensureProfileReady();

      let submissionId = uploadDraft.submissionId;
      if (!submissionId) {
        const submission = await createSubmission({
          submissionKind: 'event',
          summary: uploadDraft.title.trim() || (total > 1 ? `上传报告 ${total} 份` : queue[0].name),
          changedSinceLast: false,
        });
        submissionId = submission.id;
        const createdId = submission.id;
        setUploadDraft((prev) => ({ ...prev, submissionId: createdId }));
      }

      const baseTitle = uploadDraft.title.trim();

      const results = await uploadPatientDocumentsSerially({
        documentType: 'other',
        submissionId: submissionId ?? undefined,
        items: queue.map((item, index) => ({
          key: item.key,
          // One title across N files would put the same name on every
          // row in 报告管理. Number them so they stay tellable apart
          // until OCR replaces the name with what it read.
          title: baseTitle
            ? total > 1
              ? `${baseTitle}（${index + 1}/${total}）`
              : baseTitle
            : undefined,
          file: item.file,
          // The row already knows how big it is (the same number the
          // 单份上限 check used). Forwarding it lets the request
          // deadline scale with the payload instead of giving a 9 MB
          // scan the same budget as a 200 KB one.
          sizeBytes: item.sizeBytes,
        })),
        onItemStart: (item, index) => {
          setUploadRun({ current: index + 1, total, name: queue[index].name });
          setUploadDraft((prev) => ({
            ...prev,
            items: prev.items.map((row) =>
              row.key === item.key ? { ...row, status: 'uploading' as const, error: null } : row,
            ),
          }));
        },
        onItemSettled: (result) => {
          setUploadDraft((prev) => ({
            ...prev,
            items: prev.items.map((row) => {
              if (row.key !== result.key) {
                return row;
              }
              return result.document
                ? {
                    ...row,
                    status: 'success' as const,
                    error: null,
                    documentId: result.document.id,
                  }
                : {
                    ...row,
                    status: 'failed' as const,
                    error: describeUploadFailure(result.error),
                  };
            }),
          }));
        },
      });

      const succeeded = results.filter((result) => result.document !== null);
      const failed = results.filter((result) => result.document === null);
      const nameOf = (key: string) => queue.find((item) => item.key === key)?.name ?? '报告';

      // Uploaded rows leave the queue; failed ones stay, because the
      // retry belongs next to the file that needs it.
      setUploadDraft((prev) => {
        const remaining = prev.items.filter((item) => item.status !== 'success');
        return {
          title: remaining.length > 0 ? prev.title : '',
          items: remaining,
          // A cleared queue ends the visit, so the next batch opens its
          // own submission. While failed rows remain, retries keep
          // landing in the submission this batch already created.
          submissionId: remaining.length > 0 ? prev.submissionId : null,
        };
      });

      if (failed.length === 0) {
        const onlyDocumentId = succeeded.length === 1 ? succeeded[0].document?.id : null;
        notify({
          title: succeeded.length > 1 ? `${succeeded.length} 份报告已上传` : '报告已上传',
          message: [
            succeeded.length > 1
              ? `${succeeded.length} 份都已进入系统，正在后台自动识别。识别完成前可以先做别的，识别好了会出现在报告列表里。`
              : `「${nameOf(succeeded[0].key)}」已进入系统，正在自动识别，大约 1 分钟。`,
            '识别完成后会自动更新到时间轴、报告管理和检查结果——不用守着这个页面等。',
          ].join('\n'),
          tone: 'success',
          // One report has a place to land (its own detail screen, where
          // the OCR result appears); several do not, so send those to
          // the list that holds all of them.
          action: onlyDocumentId
            ? {
                label: '查看识别结果',
                onPress: () =>
                  router.push({
                    pathname: '/p-report_detail',
                    params: { documentId: onlyDocumentId },
                  }),
              }
            : { label: '打开报告管理', onPress: () => router.push('/p-report_management') },
        });
      } else {
        notify({
          title:
            succeeded.length > 0
              ? `成功 ${succeeded.length} 份，${failed.length} 份没传上去`
              : '这批报告没能上传',
          message: [
            ...failed.map(
              (result) => `·「${nameOf(result.key)}」：${describeUploadFailure(result.error)}`,
            ),
            '',
            succeeded.length > 0
              ? `成功的 ${succeeded.length} 份已经在识别了。没传上去的还留在下面的列表里，点它旁边的重试可以单独再传一次。`
              : '文件都还留在下面的列表里，点它旁边的重试可以单独再传一次。',
          ].join('\n'),
          tone: 'error',
          action:
            succeeded.length > 0
              ? {
                  label: '打开报告管理',
                  onPress: () => router.push('/p-report_management'),
                }
              : undefined,
        });
        setFormNotice(`有 ${failed.length} 份没有上传成功，可以在下面的列表里单独重试。`);
      }
    } catch (error) {
      // Batch-level failure: no profile, or the submission shell itself
      // failed. Nothing was uploaded and the queue is untouched, so the
      // patient can press upload again once the cause is fixed.
      const message = error instanceof Error ? error.message : '报告上传失败';
      setFormNotice(message);
      notify({ title: '这批报告没能上传', message, tone: 'error' });
    } finally {
      setUploadRun(null);
    }
  };

  const uploadItemMeta = (item: UploadItem) => {
    const size = item.sizeBytes !== null ? formatBytes(item.sizeBytes) : null;
    switch (item.status) {
      case 'uploading':
        return '正在上传…';
      case 'success':
        return '已上传，正在识别';
      case 'failed':
        return `上传失败：${item.error ?? '未知原因'}`;
      default:
        return size ? `${size} · 等待上传` : '等待上传';
    }
  };

  const renderUploadQueue = () => {
    if (uploadDraft.items.length === 0) {
      return null;
    }

    const knownBytes = uploadDraft.items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);

    return (
      <View style={styles.uploadQueue}>
        <View style={styles.uploadQueueHeader}>
          <Text style={styles.uploadQueueCount}>
            已选 {uploadDraft.items.length} / {MAX_BATCH_FILES} 份
            {knownBytes > 0 ? ` · 共 ${formatBytes(knownBytes)}` : ''}
          </Text>
          <Button
            label="全部清空"
            variant="plain"
            compact
            disabled={uploadBusy}
            accessibilityLabel="清空已选的报告"
            onPress={clearUploadQueue}
          />
        </View>

        {uploadDraft.items.map((item) => (
          <View key={item.key} style={styles.uploadItem}>
            {item.status === 'uploading' ? (
              <ActivityIndicator size="small" color={COLOR.accent} />
            ) : (
              <Icon
                name={
                  item.status === 'success'
                    ? 'circle-check'
                    : item.status === 'failed'
                      ? 'circle-exclamation'
                      : 'clock'
                }
                size={14}
                color={
                  item.status === 'success'
                    ? COLOR.good
                    : item.status === 'failed'
                      ? COLOR.alert
                      : COLOR.inkMuted
                }
              />
            )}

            <View style={styles.uploadItemText}>
              <Text style={styles.uploadItemName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text
                style={[
                  styles.uploadItemMeta,
                  item.status === 'failed' && styles.uploadItemMetaError,
                ]}
              >
                {uploadItemMeta(item)}
              </Text>
            </View>

            {/* Retry is per row, not per batch: re-uploading the six
                that already went through would duplicate them. */}
            {item.status === 'failed' ? (
              <PressableScale
                style={styles.uploadItemAction}
                disabled={uploadBusy}
                accessibilityRole="button"
                accessibilityLabel={`重新上传 ${item.name}`}
                onPress={() => void runUploadBatch([item.key])}
              >
                <Icon
                  name="rotate-right"
                  size={15}
                  color={uploadBusy ? COLOR.inkFaint : COLOR.accent}
                />
              </PressableScale>
            ) : null}

            {item.status !== 'uploading' && item.status !== 'success' ? (
              <PressableScale
                style={styles.uploadItemAction}
                disabled={uploadBusy}
                accessibilityRole="button"
                accessibilityLabel={`移除 ${item.name}`}
                onPress={() => removeUploadItem(item.key)}
              >
                <Icon name="xmark" size={15} color={uploadBusy ? COLOR.inkFaint : COLOR.inkMuted} />
              </PressableScale>
            ) : null}
          </View>
        ))}

        {uploadRun ? (
          <Text style={styles.uploadProgressText}>
            正在上传第 {uploadRun.current} / {uploadRun.total} 份：{uploadRun.name}
          </Text>
        ) : null}
      </View>
    );
  };

  const renderUploadSection = () => (
    <View style={styles.formSection}>
      <Text style={styles.sectionTitle}>报告上传</Text>
      <Text style={styles.sectionSubtitle}>
        一次可以选多份，逐份上传并自动识别类型、报告时间和关键指标，不需要手动选类别。
      </Text>

      <View style={styles.fieldBlock}>
        <Text style={styles.fieldLabel}>报告标题（可选）</Text>
        <TextInput
          value={uploadDraft.title}
          onChangeText={(value) => setUploadDraft((prev) => ({ ...prev, title: value }))}
          placeholder="可留空，系统会按识别结果展示名称"
          placeholderTextColor={COLOR.inkFaint}
          style={styles.input}
          editable={!uploadBusy}
        />
      </View>

      <Button
        label="拍照添加（拍完可以接着拍下一张）"
        icon="camera"
        variant="tinted"
        fullWidth
        disabled={uploadBusy}
        onPress={() => void pickImages('camera')}
      />

      <View style={styles.uploadAltRow}>
        <Button
          label="相册多选"
          icon="images"
          variant="tinted"
          compact
          disabled={uploadBusy}
          style={styles.uploadAltButton}
          onPress={() => void pickImages('library')}
        />
        <Button
          label="选择 PDF（可多选）"
          icon="file-pdf"
          variant="tinted"
          compact
          disabled={uploadBusy}
          style={styles.uploadAltButton}
          onPress={() => void pickDocuments()}
        />
      </View>

      {renderUploadQueue()}
    </View>
  );

  // Reference values so the user sees "this time vs last time" while
  // typing — the inputs are pre-filled from the profile, but once the
  // user edits them the previous number would otherwise be gone.
  const previousStairClimb = profile ? getLatestFunctionTestValue(profile, 'stair_climb') : null;
  const previousSleepScore = profile ? getLatestSymptomValue(profile, 'sleep_quality') : null;
  // Reference only. Unlike sleep, these two are NOT pre-filled into the
  // form — see FollowupFormState.painScore.
  const previousPainScore = profile ? getLatestSymptomValue(profile, PAIN_SCALE.key) : null;
  const previousFatigueScore = profile ? getLatestSymptomValue(profile, FATIGUE_SCALE.key) : null;

  // The baseline profile already says whether stairs are plausible:
  // 「独立行走」answered no, or a device that rules them out. Used ONLY
  // to word the hint beside the toggle so the patient doesn't have to
  // re-explain what they already told us — never to pre-select it,
  // because the toggle is itself a record of today, and a record the
  // patient didn't make is a fabricated one.
  const stairsLikelyOutOfReach =
    profile?.baseline?.currentStatus?.independentlyAmbulatory === false ||
    (profile?.baseline?.currentStatus?.assistiveDevices ?? []).some(
      (device) => device === '轮椅' || device === '助行器',
    );

  const renderFollowupForm = () => (
    <View style={styles.formStack}>
      <View style={styles.formSection}>
        <Text style={styles.sectionTitle}>日常记录</Text>
        <Text style={styles.sectionSubtitle}>
          这里直接记录患者端仍在持续追踪的量化数据；新问题、辅具、训练和用药变化请放到“事件记录”。
        </Text>
        <View style={styles.fieldBlock}>
          <View style={styles.fieldHeaderRow}>
            <Text style={styles.fieldLabel}>标准化上楼记录</Text>
            <Text style={styles.fieldHint}>连续上 10 级台阶</Text>
          </View>
          <Text style={styles.sectionSubtitle}>
            {followupForm.stairNotApplicable
              ? '已标记“今天做不了”，本次不填秒数。'
              : stairsLikelyOutOfReach
                ? '你在档案里填过行动需要辅助，所以先说明：上不了楼梯不用留空，点下面的“今天做不了 / 不适用”就行，这一条同样会被记录。如果今天能走，请填完成 10 级台阶的秒数，中途停顿或扶栏也按实际用时填。'
                : '请填写这次完成 10 级台阶所用的秒数；中途停顿或扶栏也按实际用时填。今天做不了就点下面的按钮，不用留空。'}
          </Text>

          {/* The copy above has always said「无法完成」was a normal
              answer while the validator demanded seconds > 0. This is
              that answer, and it saves a record (see
              notApplicable) rather than a blank. */}
          <View style={styles.choiceRow}>
            <PressableScale
              style={[
                styles.choiceChip,
                followupForm.stairNotApplicable && styles.choiceChipActive,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: followupForm.stairNotApplicable }}
              aria-selected={followupForm.stairNotApplicable}
              accessibilityLabel="今天做不了 10 级台阶，本次不填用时"
              onPress={() => {
                setFollowupForm((prev) => ({
                  ...prev,
                  stairNotApplicable: !prev.stairNotApplicable,
                }));
                setFollowupFieldErrors((prev) => ({ ...prev, stairClimb: undefined }));
              }}
            >
              <Text
                style={[
                  styles.choiceChipText,
                  followupForm.stairNotApplicable && styles.choiceChipTextActive,
                ]}
              >
                今天做不了 / 不适用
              </Text>
            </PressableScale>
          </View>

          {followupForm.stairNotApplicable ? (
            <Text style={styles.previousValueText}>
              会记为“今天上不了 10 级台阶”，不是空白漏填。
            </Text>
          ) : (
            <>
              <TextInput
                value={followupForm.stairClimbSeconds}
                onChangeText={(value) => {
                  setFollowupForm((prev) => ({
                    ...prev,
                    stairClimbSeconds: sanitizeDecimalText(value),
                  }));
                  // Same contract as the register form (#71): an armed
                  // error clears as soon as the user edits the field.
                  setFollowupFieldErrors((prev) => ({ ...prev, stairClimb: undefined }));
                }}
                placeholder="例如 18.5"
                placeholderTextColor={COLOR.inkFaint}
                keyboardType="decimal-pad"
                style={styles.input}
              />
              {followupFieldErrors.stairClimb ? (
                <Text style={styles.fieldErrorText}>{followupFieldErrors.stairClimb}</Text>
              ) : null}
              {typeof previousStairClimb === 'number' ? (
                <Text style={styles.previousValueText}>
                  上次记录：{previousStairClimb.toFixed(1)} 秒
                </Text>
              ) : null}
              {/* A legend for the field above, not four controls —
                  it was rendered as four pill-shaped chips, which
                  read as tappable and were not. */}
              <View style={styles.scoreHintWrap}>
                <Text style={styles.scoreHintText}>
                  ≤10 秒 较轻松 · 11-20 秒 一般 · 21-30 秒 偏慢 · &gt;30 秒 需关注
                </Text>
              </View>
            </>
          )}
        </View>
        {renderSleepScorePicker({
          value: followupForm.sleepScore,
          notApplicable: followupForm.sleepNotApplicable,
          onChange: (value) => {
            setFollowupForm((prev) => ({ ...prev, sleepScore: value }));
            setFollowupFieldErrors((prev) => ({ ...prev, sleep: undefined }));
          },
          onToggleNotApplicable: () => {
            setFollowupForm((prev) => ({ ...prev, sleepNotApplicable: !prev.sleepNotApplicable }));
            setFollowupFieldErrors((prev) => ({ ...prev, sleep: undefined }));
          },
        })}
        {followupFieldErrors.sleep ? (
          <Text style={styles.fieldErrorText}>{followupFieldErrors.sleep}</Text>
        ) : null}
        {typeof previousSleepScore === 'number' ? (
          <Text style={styles.previousValueText}>上次记录：{previousSleepScore}/10</Text>
        ) : null}

        {/* 疼痛 and 疲劳. Both keys have been in the API's SYMPTOM_KEYS
            from the start; this form simply never wrote them, which is
            why production holds sleep rows and almost no pain rows for
            a disease where pain and fatigue are among the most common
            complaints. The note carries the guideline that says to ask
            every time. */}
        <Text style={styles.guidelineNote}>{SYMPTOM_GUIDELINE_NOTE}</Text>

        {renderSymptomScorePicker({
          scale: PAIN_SCALE,
          value: followupForm.painScore,
          onChange: (value) => setFollowupForm((prev) => ({ ...prev, painScore: value })),
        })}
        {typeof previousPainScore === 'number' ? (
          <Text style={styles.previousValueText}>上次记录：{previousPainScore}/10</Text>
        ) : null}

        {renderSymptomScorePicker({
          scale: FATIGUE_SCALE,
          value: followupForm.fatigueScore,
          onChange: (value) => setFollowupForm((prev) => ({ ...prev, fatigueScore: value })),
        })}
        {typeof previousFatigueScore === 'number' ? (
          <Text style={styles.previousValueText}>上次记录：{previousFatigueScore}/10</Text>
        ) : null}

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>最近跌倒次数</Text>
          <Text style={styles.sectionSubtitle}>
            按最近一段时间内发生的实际跌倒次数填写；没有跌倒就填 0。
          </Text>
          <TextInput
            value={followupForm.fallCount}
            onChangeText={(value) => {
              setFollowupForm((prev) => ({
                ...prev,
                fallCount: sanitizeIntegerText(value),
              }));
              setFollowupFieldErrors((prev) => ({ ...prev, fall: undefined }));
            }}
            placeholder="0"
            placeholderTextColor={COLOR.inkFaint}
            keyboardType="number-pad"
            style={styles.input}
          />
          {followupFieldErrors.fall ? (
            <Text style={styles.fieldErrorText}>{followupFieldErrors.fall}</Text>
          ) : null}
        </View>
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>今天的活动（可选）</Text>
          <Text style={styles.sectionSubtitle}>
            例如散步 20 分钟、拉伸训练——一句话即可，会计入时间轴。
          </Text>
          <TextInput
            value={followupForm.activityNote}
            onChangeText={(value) => setFollowupForm((prev) => ({ ...prev, activityNote: value }))}
            placeholder="今天做了什么活动？"
            placeholderTextColor={COLOR.inkFaint}
            style={styles.input}
            maxLength={200}
          />
        </View>
      </View>

      {formNotice ? <InlineNotice message={formNotice} /> : null}
      {/* Also blocked while a report batch is uploading: the two share
          `ensureProfileReady` and the loading overlay, and a save fired
          mid-batch would put its own spinner over a queue the patient
          is watching. */}
      <Button
        label="完成今日记录"
        variant="prominent"
        fullWidth
        busy={isSubmitting}
        disabled={uploadBusy}
        style={styles.submitButton}
        onPress={handleFollowupSubmit}
      />
    </View>
  );

  const renderReportForm = () => (
    <View style={styles.formStack}>
      {renderUploadSection()}

      <View style={styles.formSection}>
        <Text style={styles.sectionTitle}>上传后会自动完成这些事</Text>
        <Text style={styles.sectionSubtitle}>
          系统会自动识别报告分类、提取日期和关键指标，并在时间轴、报告管理和检查结果里更新展示。
        </Text>
        <View style={styles.tipList}>
          <View style={styles.tipItem}>
            <Icon name="check" size={12} color={COLOR.accent} />
            <Text style={styles.tipText}>
              支持 PDF 和拍照图片；单份 {MAX_UPLOAD_LABEL} 以内，一次最多 {MAX_BATCH_FILES} 份、合计{' '}
              {MAX_BATCH_LABEL}
            </Text>
          </View>
          <View style={styles.tipItem}>
            <Icon name="check" size={12} color={COLOR.accent} />
            <Text style={styles.tipText}>
              逐份上传，其中一份失败不影响其他几份，可以单独重试；上传完成后在后台识别
            </Text>
          </View>
          <View style={styles.tipItem}>
            <Icon name="check" size={12} color={COLOR.accent} />
            <Text style={styles.tipText}>上传后可在“报告管理”里查看和删除</Text>
          </View>
        </View>
      </View>

      {formNotice ? <InlineNotice message={formNotice} /> : null}
      <Button
        label={
          uploadRun
            ? `正在上传第 ${uploadRun.current} / ${uploadRun.total} 份…`
            : queuedCount === 0
              ? '先选择要上传的报告'
              : `上传这 ${queuedCount} 份报告`
        }
        variant="prominent"
        fullWidth
        disabled={uploadBusy || queuedCount === 0}
        style={styles.submitButton}
        onPress={() => void runUploadBatch()}
      />
    </View>
  );

  const renderEventForm = () => (
    <View style={styles.formStack}>
      <View style={styles.formSection}>
        <Text style={styles.sectionTitle}>事件与干预记录</Text>
        <Text style={styles.sectionSubtitle}>
          辅具、训练、用药变化和补充说明都放在这里，不再和日常记录分开填。
        </Text>
        <View style={styles.choiceRow}>
          {eventOptions.map((option) => (
            <PressableScale
              key={option.key}
              style={[
                styles.choiceChip,
                eventForm.eventType === option.key && styles.choiceChipActive,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected: eventForm.eventType === option.key }}
              aria-checked={eventForm.eventType === option.key}
              accessibilityLabel={option.label}
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
            </PressableScale>
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
            placeholderTextColor={COLOR.inkFaint}
            style={styles.input}
          />
        </View>

        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>发生了什么 / 这次做了什么调整</Text>
          <TextInput
            value={eventForm.description}
            onChangeText={(value) => setEventForm((prev) => ({ ...prev, description: value }))}
            placeholder="例如：开始使用 AFO，每周增加 2 次康复训练；这一周更容易绊脚"
            placeholderTextColor={COLOR.inkFaint}
            multiline
            style={[styles.input, styles.textarea]}
          />
        </View>
      </View>

      {formNotice ? <InlineNotice message={formNotice} /> : null}
      <Button
        label="保存事件记录"
        variant="prominent"
        fullWidth
        busy={isSubmitting}
        disabled={uploadBusy}
        style={styles.submitButton}
        onPress={handleEventSubmit}
      />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Plain paper, not a page-wide gradient: the gradient pulled
          contrast out of everything sitting on it. */}
      <View style={styles.backgroundGradient}>
        {/* This screen is the centre FAB's target — the most-visited
            screen in the app — and it is a stack screen, not a tab: the
            root Stack runs headerShown:false and the tab bar doesn't
            render here, so until now it had no exit at all except the
            iOS edge swipe, i.e. the one gesture this population can
            least rely on. Outside the ScrollView so it stays reachable
            without scrolling back to the top of a long form. */}
        <ScreenHeader title="记一笔" />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Back/home live in the ScreenHeader above. The old
              「PATIENT ENTRY」eyebrow is gone: 记录数据 says it already,
              in the language the patient reads. */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>记录数据</Text>
            {/* Whose record this is. Was two boxes inside the hero
                card; a record header states it in a line. */}
            <View style={styles.headerMetaRow}>
              <View style={styles.headerMetaItem}>
                <Text style={styles.headerMetaLabel}>当前档案</Text>
                <Text style={styles.headerMetaValue}>
                  {profile?.fullName ?? (isProfileUnknown ? '读取失败' : '未建档')}
                </Text>
              </View>
              <View style={styles.headerMetaDivider} />
              <View style={styles.headerMetaItem}>
                <Text style={styles.headerMetaLabel}>基础档案</Text>
                <Text style={styles.headerMetaValue}>
                  {profile?.baseline ? '已完成' : isProfileUnknown ? '—' : '注册时补'}
                </Text>
              </View>
            </View>
          </View>

          {/* 说一句话 — the primary path, and the single filled surface
              on this screen. The mode list below is the fallback for
              people who'd rather fill fields directly, not the toll
              gate everyone has to pass through first. */}
          <View style={styles.speakCard}>
            <View style={styles.speakHeader}>
              <Icon name="wand-magic-sparkles" size={14} color={COLOR.accent} />
              <Text style={styles.speakTitle}>说一句话就行</Text>
            </View>
            <Text style={styles.speakHint}>
              比如「今天上楼特别费劲，大概十五秒，下午在厨房差点摔了」——AI
              会整理成表单，你核对后再保存。
            </Text>

            <TextInput
              style={styles.speakInput}
              value={speakText}
              onChangeText={setSpeakText}
              placeholder="今天感觉怎么样？"
              placeholderTextColor={COLOR.inkFaint}
              multiline
              maxLength={500}
              editable={!speakBusy}
            />

            {/* One line, and only a line.
                This card's whole argument is that typing is the most
                expensive thing this screen asks for — and then it asks
                for up to 500 characters of it. Most Chinese keyboards
                already carry a 语音 key (搜狗 / 讯飞 / 微信键盘, and
                iOS 听写), so the cheaper path exists on the patient's
                own phone and simply goes unmentioned. Saying so costs
                one sentence and no dependency, and nothing here fetches
                from an external host.

                Phrased as an alternative on purpose, never as the
                recommended path: FSHD weakens the face, so speech is
                harder for some of the people reading this, not easier.
                An app that told them to「说」would be telling them to
                use the thing the disease took. So the sentence names
                both directions and ends on typing still being fine. */}
            <Text style={styles.speakVoiceHint}>
              不方便打字的话，可以用手机键盘上的语音键说出来（搜狗、讯飞、微信键盘和 iOS
              听写都有）；说话费劲就直接打字，或者用下面的表单一项项填，都一样。
            </Text>

            <Button
              label="整理成记录"
              icon="wand-magic-sparkles"
              variant="tinted"
              fullWidth
              busy={speakBusy}
              disabled={!speakText.trim()}
              onPress={() => void handleDraftFromSpeech()}
            />

            {speakNotice ? (
              <View style={styles.speakNoticeWrap}>
                <InlineNotice message={speakNotice} />
              </View>
            ) : null}
          </View>

          {/* Four hairline rows, not a 2×2 grid of shadowed tiles. The
              2pt accent stripe is the only "this one is selected"
              signal now — it replaces a filled card background, a
              tinted icon square and a「当前任务」badge that all said
              the same thing, plus the 当前已选择 recap card underneath
              that said it a fourth time. */}
          <View style={styles.modeSection}>
            <View style={styles.modeSectionHeader}>
              <Text style={styles.modeSectionTitle}>选择本次任务</Text>
            </View>

            <View style={styles.modeList}>
              {modeCards.map((item) => {
                const active = entryMode === item.key;
                return (
                  <PressableScale
                    key={item.key}
                    style={styles.modeRow}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    aria-selected={active}
                    onPress={() => {
                      setEntryMode(item.key);
                      // Notices/validation belong to the mode they
                      // came from — don't leak into the next form.
                      setFormNotice(null);
                      setFollowupFieldErrors({});
                    }}
                  >
                    <View style={[styles.modeStripe, active && styles.modeStripeActive]} />
                    <Icon
                      name={item.icon}
                      size={16}
                      color={active ? COLOR.accent : COLOR.inkMuted}
                    />
                    <View style={styles.modeTextWrap}>
                      <Text style={[styles.modeTitle, active && styles.modeTitleActive]}>
                        {item.title}
                      </Text>
                      <Text style={styles.modeDescription}>{item.description}</Text>
                    </View>
                  </PressableScale>
                );
              })}
            </View>
          </View>

          {entryMode === 'followup' ? renderFollowupForm() : null}
          {entryMode === 'event' ? renderEventForm() : null}
          {entryMode === 'report' ? renderReportForm() : null}
          {entryMode === 'muscle' ? <MuscleSelfTestForm /> : null}
          {entryMode === 'instrument' ? (
            // The consent gate is the screen's, not the child's: an
            // administration stores health data, and the POST is behind
            // the same `sensitiveDataConsent` middleware as every other
            // write here.
            <InstrumentForm ensureConsent={ensureSensitiveDataConsent} />
          ) : null}
        </ScrollView>

        {(isLoading || isSubmitting) && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={COLOR.accent} />
            <Text style={styles.loadingText}>
              {isSubmitting ? '正在保存这次记录...' : '正在加载录入页面...'}
            </Text>
          </View>
        )}
      </View>
      <SensitiveDataConsentGate {...gateProps} />
    </SafeAreaView>
  );
};

export default DataEntryScreen;

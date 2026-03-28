import type { PatientProfile, ProgressionSummary } from './api';

export type DomainTrendKey = 'upper_limb' | 'lower_limb' | 'face' | 'breathing' | 'symptoms';

export interface DomainTrendPoint {
  date: string;
  timestamp: string;
  value: number;
}

export interface DomainTrendCard {
  key: DomainTrendKey;
  label: string;
  currentValue: number | null;
  previousValue: number | null;
  delta: number | null;
  trend: 'better' | 'stable' | 'worse' | 'new';
  summary: string;
  points: DomainTrendPoint[];
  hasData: boolean;
}

export interface DiseaseBackgroundFact {
  label: string;
  value: string;
}

export interface ProgressionTimelineItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '事件' | '报告' | '功能测试' | '随访';
}

const upperLimbKeys = new Set([
  'deltoid',
  'biceps',
  'triceps',
  'shoulder_abduction',
  'shoulder_abduction_mrc',
  'arm_raise_over_head',
  'elbow_flexion',
]);

const lowerLimbKeys = new Set([
  'tibialis',
  'quadriceps',
  'hamstrings',
  'gluteus',
  'ankle_dorsiflexion',
  'knee_extension',
]);

const faceKeys = new Set(['eye_closure', 'lip_pursing']);

const toIsoDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
};

const roundOne = (value: number) => Number(value.toFixed(1));

const average = (values: number[]) => {
  if (!values.length) {
    return null;
  }

  return roundOne(values.reduce((sum, value) => sum + value, 0) / values.length);
};

const pushBucketValue = (
  buckets: Map<string, { timestamp: string; values: number[] }>,
  timestamp: string,
  value: number,
) => {
  const key = toIsoDate(timestamp);
  const current = buckets.get(key);
  if (current) {
    current.values.push(value);
    if (new Date(timestamp).getTime() > new Date(current.timestamp).getTime()) {
      current.timestamp = timestamp;
    }
    return;
  }

  buckets.set(key, { timestamp, values: [value] });
};

const finalizeTrendPoints = (
  buckets: Map<string, { timestamp: string; values: number[] }>,
  limit = 6,
): DomainTrendPoint[] =>
  Array.from(buckets.entries())
    .map(([date, item]) => ({
      date,
      timestamp: item.timestamp,
      value: average(item.values) ?? 0,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-limit);

const toBurdenFromStrength = (score: number) => roundOne((5 - score) * 2);

const formatTrendSummary = (label: string, current: number | null, delta: number | null) => {
  if (current === null) {
    return `${label}还没有足够记录。`;
  }

  const level = current >= 7 ? '较明显' : current >= 4 ? '中等' : '较轻';
  if (delta === null) {
    return `${label}目前影响${level}，已建立第一条趋势记录。`;
  }

  if (delta === 0) {
    return `${label}目前影响${level}，和上次相比变化不大。`;
  }

  return delta > 0
    ? `${label}目前影响${level}，比上次更明显。`
    : `${label}目前影响${level}，比上次减轻。`;
};

const buildTrendCard = (
  key: DomainTrendKey,
  label: string,
  points: DomainTrendPoint[],
): DomainTrendCard => {
  const currentValue = points.length ? points[points.length - 1].value : null;
  const previousValue = points.length > 1 ? points[points.length - 2].value : null;
  const delta =
    currentValue !== null && previousValue !== null ? roundOne(currentValue - previousValue) : null;
  const trend: DomainTrendCard['trend'] =
    currentValue === null
      ? 'stable'
      : previousValue === null
        ? 'new'
        : delta === 0
          ? 'stable'
          : delta !== null && delta > 0
            ? 'worse'
            : 'better';

  return {
    key,
    label,
    currentValue,
    previousValue,
    delta,
    trend,
    summary: formatTrendSummary(label, currentValue, delta),
    points,
    hasData: currentValue !== null,
  };
};

export const buildDomainTrendCards = (profile: PatientProfile | null): DomainTrendCard[] => {
  const empty = [
    buildTrendCard('upper_limb', '上肢', []),
    buildTrendCard('lower_limb', '下肢/步态', []),
    buildTrendCard('face', '面部', []),
    buildTrendCard('breathing', '呼吸', []),
    buildTrendCard('symptoms', '疲劳/疼痛', []),
  ];

  if (!profile) {
    return empty;
  }

  const upperBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const lowerBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const faceBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const breathingBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const symptomBuckets = new Map<string, { timestamp: string; values: number[] }>();

  profile.measurements.forEach((item) => {
    const key = item.metricKey ?? item.muscleGroup;
    const burden = toBurdenFromStrength(Number(item.strengthScore));
    if (upperLimbKeys.has(key)) {
      pushBucketValue(upperBuckets, item.recordedAt, burden);
    }
    if (lowerLimbKeys.has(key)) {
      pushBucketValue(lowerBuckets, item.recordedAt, burden);
    }
    if (faceKeys.has(key)) {
      pushBucketValue(faceBuckets, item.recordedAt, burden);
    }
  });

  profile.dailyImpacts.forEach((item) => {
    const burden = roundOne(item.difficultyLevel * 2);
    if (['reaching_up', 'dressing', 'hair_washing'].includes(item.adlKey)) {
      pushBucketValue(upperBuckets, item.recordedAt, burden);
    }
    if (['stairs', 'walking_outdoors'].includes(item.adlKey)) {
      pushBucketValue(lowerBuckets, item.recordedAt, burden);
    }
  });

  profile.symptomScores.forEach((item) => {
    if (item.symptomKey === 'dyspnea') {
      pushBucketValue(breathingBuckets, item.recordedAt, Number(item.score));
    }

    if (item.symptomKey === 'fatigue' || item.symptomKey === 'pain') {
      pushBucketValue(symptomBuckets, item.recordedAt, Number(item.score));
    }

    if (item.symptomKey === 'sleep_quality') {
      pushBucketValue(symptomBuckets, item.recordedAt, roundOne(10 - Number(item.score)));
    }
  });

  profile.followupEvents.forEach((item) => {
    if (item.eventType === 'new_breathing_discomfort') {
      pushBucketValue(breathingBuckets, item.occurredAt, 7);
    }
    if (item.eventType === 'new_foot_drop') {
      pushBucketValue(lowerBuckets, item.occurredAt, 7);
    }
    if (item.eventType === 'new_arm_raise_difficulty') {
      pushBucketValue(upperBuckets, item.occurredAt, 7);
    }
  });

  return [
    buildTrendCard('upper_limb', '上肢', finalizeTrendPoints(upperBuckets)),
    buildTrendCard('lower_limb', '下肢/步态', finalizeTrendPoints(lowerBuckets)),
    buildTrendCard('face', '面部', finalizeTrendPoints(faceBuckets)),
    buildTrendCard('breathing', '呼吸', finalizeTrendPoints(breathingBuckets)),
    buildTrendCard('symptoms', '疲劳/疼痛', finalizeTrendPoints(symptomBuckets)),
  ];
};

export const buildDiseaseBackgroundFacts = (
  profile: PatientProfile | null,
): DiseaseBackgroundFact[] => {
  if (!profile) {
    return [];
  }

  const foundation = profile.baseline?.foundation;
  const diseaseBackground = profile.baseline?.diseaseBackground;
  const currentStatus = profile.baseline?.currentStatus;
  const currentChallenges = profile.baseline?.currentChallenges;
  const assistiveDevices = currentStatus?.assistiveDevices?.filter(Boolean).join('、') || '未记录';

  return [
    { label: '姓名/昵称', value: foundation?.fullName ?? profile.fullName ?? '未填写' },
    {
      label: '确诊时间',
      value:
        foundation?.diagnosisYear !== null && foundation?.diagnosisYear !== undefined
          ? String(foundation.diagnosisYear)
          : (profile.diagnosisDate?.slice(0, 10) ?? '未填写'),
    },
    { label: '所在地区', value: foundation?.regionLabel ?? profile.regionCity ?? '未填写' },
    { label: '分型', value: diseaseBackground?.diagnosisType ?? '未填写' },
    { label: '首发部位', value: diseaseBackground?.onsetRegion ?? '未填写' },
    {
      label: '当前行走',
      value:
        currentStatus?.independentlyAmbulatory === true
          ? '可独立行走'
          : currentStatus?.independentlyAmbulatory === false
            ? '需要辅助'
            : '未填写',
    },
    {
      label: '呼吸状态',
      value:
        currentStatus?.breathingSymptoms === true
          ? '有气短或睡眠呼吸问题'
          : currentStatus?.breathingSymptoms === false
            ? '目前未记录呼吸问题'
            : '未填写',
    },
    { label: '辅具', value: assistiveDevices },
    {
      label: '当前困扰',
      value: currentChallenges
        ? ['fatigue', 'pain', 'stairs', 'reachingUp']
            .map((key) => {
              const value = currentChallenges[key as keyof typeof currentChallenges];
              if (typeof value !== 'number') {
                return null;
              }
              const labels: Record<string, string> = {
                fatigue: '疲劳',
                pain: '疼痛',
                stairs: '上下楼',
                reachingUp: '抬手',
              };
              return `${labels[key]} ${value}/5`;
            })
            .filter(Boolean)
            .join('，') || '未填写'
        : '未填写',
    },
  ];
};

export const buildProgressionTimeline = (
  profile: PatientProfile | null,
  summary?: ProgressionSummary | null,
  limit = 12,
): ProgressionTimelineItem[] => {
  if (!profile) {
    return [];
  }

  const items: ProgressionTimelineItem[] = [];

  profile.followupEvents.forEach((item) => {
    const eventLabels: Record<string, string> = {
      fall: '跌倒',
      new_foot_drop: '新增足下垂',
      new_arm_raise_difficulty: '新增抬手困难',
      new_breathing_discomfort: '新增呼吸不适',
      started_afo: '开始使用 AFO',
      started_wheelchair: '开始使用轮椅',
      started_niv: '开始无创通气',
      uploaded_report: '上传新报告',
      other: '病程事件',
    };
    items.push({
      id: item.id,
      title: eventLabels[item.eventType] ?? item.eventType,
      description: item.description?.trim() || '已记录新的病程事件。',
      timestamp: item.occurredAt,
      tag: '事件',
    });
  });

  profile.documents.forEach((item) => {
    const labels: Record<string, string> = {
      mri: 'MRI 报告',
      muscle_mri: 'MRI 报告',
      genetic_report: '基因报告',
      medical_summary: '病历摘要',
      physical_exam: '肌力/体格检查',
      pulmonary_function: '肺功能报告',
      diaphragm_ultrasound: '膈肌超声',
      ecg: '心电图',
      echocardiography: '心脏超声',
      biochemistry: '生化报告',
      muscle_enzyme: '肌酶报告',
      blood_routine: '血常规',
      thyroid_function: '甲功报告',
      coagulation: '凝血报告',
      urinalysis: '尿常规',
      infection_screening: '感染筛查',
      stool_test: '粪便/幽门检测',
      abdominal_ultrasound: '腹部超声',
      blood_panel: '血检/肺功能报告',
      other: '医学报告',
    };
    const payload = item.ocrPayload?.fields ?? {};
    const reportTypeLabel =
      (typeof payload.reportTypeLabel === 'string' && payload.reportTypeLabel.trim()) ||
      (typeof payload.report_type_label === 'string' && payload.report_type_label.trim()) ||
      null;
    const classifiedType =
      (typeof payload.classifiedType === 'string' && payload.classifiedType) ||
      (typeof payload.classified_type === 'string' && payload.classified_type) ||
      item.documentType;
    const aiSummary = typeof payload.aiSummary === 'string' ? payload.aiSummary.trim() : undefined;
    items.push({
      id: item.id,
      title: reportTypeLabel || labels[classifiedType] || item.title?.trim() || '新报告',
      description: aiSummary || '已上传新报告，可查看患者版摘要。',
      timestamp: item.uploadedAt,
      tag: '报告',
    });
  });

  profile.functionTests.forEach((item) => {
    const labels: Record<string, string> = {
      stair_climb: '上楼测试',
      ten_meter_walk: '10 米步行',
      sit_to_stand: '坐站转换',
      timed_up_and_go: '起立行走',
      six_minute_walk: '六分钟步行',
      custom: '功能测试',
    };
    const valueText =
      item.measuredValue !== null && item.measuredValue !== undefined
        ? `${item.measuredValue}${item.unit ? ` ${item.unit}` : ''}`
        : '已记录';
    items.push({
      id: item.id,
      title: labels[item.testType] ?? item.testType,
      description: valueText,
      timestamp: item.performedAt,
      tag: '功能测试',
    });
  });

  summary?.changeCards?.forEach((item) => {
    if (!item.evidenceAt) {
      return;
    }
    items.push({
      id: `change-${item.id}`,
      title: item.title,
      description: item.detail,
      timestamp: item.evidenceAt,
      tag: '随访',
    });
  });

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .filter((item, index, array) => {
      const firstIndex = array.findIndex((candidate) => candidate.id === item.id);
      return firstIndex === index;
    })
    .slice(0, limit);
};

export const buildMedicationHighlights = (profile: PatientProfile | null) => {
  if (!profile?.medications?.length) {
    return [];
  }

  return profile.medications.slice(0, 4).map((item) => ({
    id: item.id,
    title: item.medicationName,
    status: item.status ?? 'active',
  }));
};

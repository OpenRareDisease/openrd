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

export type PatientVisualizationKey = 'sleep_quality' | 'stair_climb' | 'fall_count';

export interface PatientVisualizationCard {
  key: PatientVisualizationKey;
  label: string;
  latestDisplay: string;
  latestValue: number | null;
  previousValue: number | null;
  trend: 'better' | 'stable' | 'worse' | 'new';
  summary: string;
  helperText: string;
  points: DomainTrendPoint[];
  unit?: string;
  chartColor: string;
}

export interface ProgressionTimelineItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '事件' | '报告' | '功能测试' | '随访';
  documentId?: string | null;
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

const finalizeSummedPoints = (
  buckets: Map<string, { timestamp: string; value: number }>,
  limit = 6,
): DomainTrendPoint[] =>
  Array.from(buckets.entries())
    .map(([date, item]) => ({
      date,
      timestamp: item.timestamp,
      value: roundOne(item.value),
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

const resolveComparisonTrend = (
  currentValue: number | null,
  previousValue: number | null,
  direction: 'higher_better' | 'lower_better',
): PatientVisualizationCard['trend'] => {
  if (currentValue === null) {
    return 'stable';
  }

  if (previousValue === null) {
    return 'new';
  }

  if (currentValue === previousValue) {
    return 'stable';
  }

  if (direction === 'higher_better') {
    return currentValue > previousValue ? 'better' : 'worse';
  }

  return currentValue < previousValue ? 'better' : 'worse';
};

const getSleepSummary = (
  currentValue: number | null,
  previousValue: number | null,
): Pick<PatientVisualizationCard, 'latestDisplay' | 'summary' | 'helperText'> => {
  if (currentValue === null) {
    return {
      latestDisplay: '未记录',
      summary: '最近还没有新的睡眠评分。',
      helperText: '0-2 很差，3-4 较差，5-6 一般，7-8 较好，9-10 很好。',
    };
  }

  const level =
    currentValue >= 9
      ? '睡得很好'
      : currentValue >= 7
        ? '整体较好'
        : currentValue >= 5
          ? '一般'
          : currentValue >= 3
            ? '偏差'
            : '很差';
  const comparison =
    previousValue === null
      ? '已建立第一条睡眠记录。'
      : currentValue === previousValue
        ? '和上次相比变化不大。'
        : currentValue > previousValue
          ? '比上次更好。'
          : '比上次更差。';

  return {
    latestDisplay: `${Math.round(currentValue)}/10`,
    summary: `最近一次睡眠评分${level}，${comparison}`,
    helperText: '0-2 很差，3-4 较差，5-6 一般，7-8 较好，9-10 很好。',
  };
};

const getStairSummary = (
  currentValue: number | null,
  previousValue: number | null,
  hasLegacyImpact: boolean,
): Pick<PatientVisualizationCard, 'latestDisplay' | 'summary' | 'helperText'> => {
  if (currentValue === null) {
    return {
      latestDisplay: hasLegacyImpact ? '待量化' : '未记录',
      summary: hasLegacyImpact
        ? '已记录上楼变化，但还没有“连续上 10 级台阶”的标准化秒数。'
        : '最近还没有新的标准化上楼计时。',
      helperText: '统一按“连续上 10 级台阶”填写用时，越短通常表示完成越轻松。',
    };
  }

  const level =
    currentValue <= 10
      ? '较轻松'
      : currentValue <= 20
        ? '尚可'
        : currentValue <= 30
          ? '偏慢'
          : '较慢';
  const comparison =
    previousValue === null
      ? '已建立第一条上楼计时。'
      : currentValue === previousValue
        ? '和上次差不多。'
        : currentValue < previousValue
          ? '比上次更快。'
          : '比上次更慢。';

  return {
    latestDisplay: `${currentValue.toFixed(1)} 秒`,
    summary: `最近一次 10 级台阶用时${currentValue.toFixed(1)} 秒，整体${level}，${comparison}`,
    helperText: '统一按“连续上 10 级台阶”填写用时，越短通常表示完成越轻松。',
  };
};

const getFallSummary = (
  currentValue: number | null,
  previousValue: number | null,
): Pick<PatientVisualizationCard, 'latestDisplay' | 'summary' | 'helperText'> => {
  if (currentValue === null) {
    return {
      latestDisplay: '未记录',
      summary: '最近还没有新的跌倒次数记录。',
      helperText: '每次快速随访都可以补充“最近跌倒次数”，便于看风险变化。',
    };
  }

  const comparison =
    previousValue === null
      ? '已建立第一条跌倒记录。'
      : currentValue === previousValue
        ? '和上次相比次数接近。'
        : currentValue < previousValue
          ? '比上次更少。'
          : '比上次更多。';

  return {
    latestDisplay: `${Math.round(currentValue)} 次`,
    summary:
      currentValue === 0
        ? `最近一次记录未填跌倒次数，${comparison}`
        : `最近一次记录跌倒 ${Math.round(currentValue)} 次，${comparison}`,
    helperText: '每次快速随访都可以补充“最近跌倒次数”，便于看风险变化。',
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

export const buildPatientVisualizationCards = (
  profile: PatientProfile | null,
): PatientVisualizationCard[] => {
  const sleepBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const stairBuckets = new Map<string, { timestamp: string; values: number[] }>();
  const fallBuckets = new Map<string, { timestamp: string; value: number }>();

  profile?.symptomScores.forEach((item) => {
    if (item.symptomKey === 'sleep_quality') {
      pushBucketValue(sleepBuckets, item.recordedAt, Number(item.score));
    }
  });

  profile?.functionTests.forEach((item) => {
    if (item.testType === 'stair_climb' && item.measuredValue !== null) {
      pushBucketValue(stairBuckets, item.performedAt, Number(item.measuredValue));
    }
  });

  profile?.followupEvents.forEach((item) => {
    if (item.eventType !== 'fall') {
      return;
    }

    const countMatch = item.description?.match(/(\d+(?:\.\d+)?)/);
    const count =
      countMatch?.[1] !== undefined
        ? Number(countMatch[1])
        : item.severity === 'severe'
          ? 3
          : item.severity === 'moderate'
            ? 2
            : 1;

    const key = toIsoDate(item.occurredAt);
    const current = fallBuckets.get(key);
    if (current) {
      current.value += count;
      if (new Date(item.occurredAt).getTime() > new Date(current.timestamp).getTime()) {
        current.timestamp = item.occurredAt;
      }
      return;
    }

    fallBuckets.set(key, {
      timestamp: item.occurredAt,
      value: count,
    });
  });

  const sleepPoints = finalizeTrendPoints(sleepBuckets);
  const stairPoints = finalizeTrendPoints(stairBuckets);
  const fallPoints = finalizeSummedPoints(fallBuckets);
  const latestLegacyStairs = profile?.dailyImpacts.find((item) => item.adlKey === 'stairs') ?? null;

  const sleepCurrent = sleepPoints.length ? sleepPoints[sleepPoints.length - 1].value : null;
  const sleepPrevious = sleepPoints.length > 1 ? sleepPoints[sleepPoints.length - 2].value : null;
  const stairCurrent = stairPoints.length ? stairPoints[stairPoints.length - 1].value : null;
  const stairPrevious = stairPoints.length > 1 ? stairPoints[stairPoints.length - 2].value : null;
  const fallCurrent = fallPoints.length ? fallPoints[fallPoints.length - 1].value : null;
  const fallPrevious = fallPoints.length > 1 ? fallPoints[fallPoints.length - 2].value : null;

  const sleepText = getSleepSummary(sleepCurrent, sleepPrevious);
  const stairText = getStairSummary(stairCurrent, stairPrevious, Boolean(latestLegacyStairs));
  const fallText = getFallSummary(fallCurrent, fallPrevious);

  return [
    {
      key: 'sleep_quality',
      label: '睡眠质量',
      latestValue: sleepCurrent,
      previousValue: sleepPrevious,
      trend: resolveComparisonTrend(sleepCurrent, sleepPrevious, 'higher_better'),
      points: sleepPoints,
      unit: '/10',
      chartColor: '#3F7A70',
      ...sleepText,
    },
    {
      key: 'stair_climb',
      label: '上楼计时',
      latestValue: stairCurrent,
      previousValue: stairPrevious,
      trend: resolveComparisonTrend(stairCurrent, stairPrevious, 'lower_better'),
      points: stairPoints,
      unit: '秒',
      chartColor: '#C98A33',
      ...stairText,
    },
    {
      key: 'fall_count',
      label: '跌倒次数',
      latestValue: fallCurrent,
      previousValue: fallPrevious,
      trend: resolveComparisonTrend(fallCurrent, fallPrevious, 'lower_better'),
      points: fallPoints,
      unit: '次',
      chartColor: '#D46A54',
      ...fallText,
    },
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
      documentId: item.id,
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

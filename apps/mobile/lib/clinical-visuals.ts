export const CLINICAL_COLORS = {
  background: '#F8F2EA',
  backgroundRaised: '#EADFCE',
  panel: '#EEE0CC',
  panelMuted: '#E2D1BA',
  border: 'rgba(24, 43, 54, 0.16)',
  text: '#182B36',
  textMuted: '#5F707A',
  textSoft: '#435863',
  accent: '#6E9F93',
  accentStrong: '#3F7A70',
  success: '#5B8F7E',
  warning: '#C98A33',
  danger: '#D46A54',
  overlay: 'rgba(24, 43, 54, 0.06)',
};

export const CLINICAL_GRADIENTS = {
  page: ['#F8F2EA', '#EADFCE', '#F5EEE4'] as const,
  surface: ['rgba(110, 159, 147, 0.24)', 'rgba(63, 122, 112, 0.18)'] as const,
};

export const CLINICAL_TINTS = {
  accentSoft: 'rgba(110, 159, 147, 0.2)',
  accentSurface: 'rgba(110, 159, 147, 0.14)',
  accentBorder: 'rgba(110, 159, 147, 0.38)',
  accentLight: 'rgba(110, 159, 147, 0.1)',
  accentStrong: 'rgba(63, 122, 112, 0.22)',
  successSoft: 'rgba(91, 143, 126, 0.2)',
  successSurface: 'rgba(91, 143, 126, 0.14)',
  successBorder: 'rgba(91, 143, 126, 0.34)',
  warningSoft: 'rgba(201, 138, 51, 0.2)',
  warningSurface: 'rgba(201, 138, 51, 0.14)',
  warningBorder: 'rgba(201, 138, 51, 0.34)',
  dangerSoft: 'rgba(212, 106, 84, 0.2)',
  dangerSurface: 'rgba(212, 106, 84, 0.14)',
  dangerBorder: 'rgba(212, 106, 84, 0.34)',
  neutralSoft: 'rgba(95, 112, 122, 0.14)',
  panel: 'rgba(24, 43, 54, 0.05)',
  panelStrong: 'rgba(24, 43, 54, 0.1)',
  borderSubtle: 'rgba(24, 43, 54, 0.1)',
  borderStrong: 'rgba(24, 43, 54, 0.16)',
  textFaint: 'rgba(24, 43, 54, 0.58)',
  surfaceOverlay: 'rgba(248, 242, 234, 0.92)',
  modalOverlay: 'rgba(24, 43, 54, 0.28)',
  disabledTrack: 'rgba(95, 112, 122, 0.24)',
  accentTrack: 'rgba(110, 159, 147, 0.65)',
};

export const MUSCLE_LABELS: Record<string, string> = {
  deltoid: '三角肌',
  biceps: '肱二头肌',
  triceps: '肱三头肌',
  tibialis: '胫前肌',
  quadriceps: '股四头肌',
  hamstrings: '腘绳肌',
  gluteus: '臀肌',
};

export type BodyView = 'front' | 'back';

export type BodyRegionId =
  | 'face'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftUpperArmFront'
  | 'rightUpperArmFront'
  | 'leftUpperArmBack'
  | 'rightUpperArmBack'
  | 'leftTorso'
  | 'rightTorso'
  | 'leftGlute'
  | 'rightGlute'
  | 'leftThighFront'
  | 'rightThighFront'
  | 'leftThighBack'
  | 'rightThighBack'
  | 'leftShin'
  | 'rightShin'
  | 'leftCalf'
  | 'rightCalf';

export type BodyRegionDatum = {
  intensity: number;
  label?: string;
};

export type BodyRegionMap = Partial<Record<BodyRegionId, BodyRegionDatum>>;

type MeasurementLike = {
  muscleGroup: string;
  metricKey?: string | null;
  side?: 'left' | 'right' | 'bilateral' | 'none' | null;
  strengthScore: number | string;
  recordedAt?: string | null;
};

type OcrPayloadLike = {
  extractedText?: string;
  fields?: Record<string, string | number>;
} | null;

const BODY_REGION_LABELS: Record<BodyRegionId, string> = {
  face: '面肌',
  leftShoulder: '左肩带',
  rightShoulder: '右肩带',
  leftUpperArmFront: '左上臂前群',
  rightUpperArmFront: '右上臂前群',
  leftUpperArmBack: '左上臂后群',
  rightUpperArmBack: '右上臂后群',
  leftTorso: '左躯干侧',
  rightTorso: '右躯干侧',
  leftGlute: '左臀肌',
  rightGlute: '右臀肌',
  leftThighFront: '左大腿前群',
  rightThighFront: '右大腿前群',
  leftThighBack: '左大腿后群',
  rightThighBack: '右大腿后群',
  leftShin: '左小腿前群',
  rightShin: '右小腿前群',
  leftCalf: '左小腿后群',
  rightCalf: '右小腿后群',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pushRegion = (
  regions: BodyRegionMap,
  regionId: BodyRegionId,
  intensity: number,
  label?: string,
) => {
  const next = clamp(Math.round(intensity), 0, 4);
  if (next <= 0) return;
  const prev = regions[regionId];
  if (!prev || next > prev.intensity) {
    regions[regionId] = {
      intensity: next,
      label: label ?? BODY_REGION_LABELS[regionId],
    };
  }
};

export const formatDateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
};

export const getRiskMeta = (level?: string | null) => {
  switch (level) {
    case 'high':
      return { label: '高关注', color: CLINICAL_COLORS.danger };
    case 'medium':
      return { label: '需观察', color: CLINICAL_COLORS.warning };
    default:
      return { label: '相对稳定', color: CLINICAL_COLORS.success };
  }
};

export const parseStrengthScore = (value: number | string | null | undefined) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)(\+|-)?/);
  if (!match) return null;
  const base = Number(match[1]);
  if (Number.isNaN(base)) return null;
  const modifier = match[2] === '+' ? 0.3 : match[2] === '-' ? -0.3 : 0;
  return clamp(base + modifier, 0, 5);
};

export const scoreToWeaknessIntensity = (score: number | null) => {
  if (score === null) return 0;
  if (score >= 4.8) return 0;
  if (score >= 4) return 1;
  if (score >= 3) return 2;
  if (score >= 2) return 3;
  return 4;
};

export const pickLatestMeasurementsByGroup = (measurements: MeasurementLike[]) => {
  const latest: Record<string, MeasurementLike> = {};
  measurements.forEach((item) => {
    const key = `${item.metricKey ?? item.muscleGroup}:${item.side ?? 'none'}`;
    const prev = latest[key];
    const currentTs = new Date(item.recordedAt ?? 0).getTime();
    const prevTs = new Date(prev?.recordedAt ?? 0).getTime();
    if (!prev || currentTs >= prevTs) {
      latest[key] = item;
    }
  });
  return latest;
};

const applySideRegion = (
  regions: BodyRegionMap,
  side: MeasurementLike['side'],
  leftRegion: BodyRegionId,
  rightRegion: BodyRegionId,
  intensity: number,
  label: string,
) => {
  if (side === 'left') {
    pushRegion(regions, leftRegion, intensity, label);
    return;
  }

  if (side === 'right') {
    pushRegion(regions, rightRegion, intensity, label);
    return;
  }

  pushRegion(regions, leftRegion, intensity, label);
  pushRegion(regions, rightRegion, intensity, label);
};

const applyStrengthGroup = (
  regions: BodyRegionMap,
  measurementKey: string,
  side: MeasurementLike['side'],
  intensity: number,
) => {
  if (intensity <= 0) return;
  switch (measurementKey) {
    case 'deltoid':
    case 'shoulder_abduction':
    case 'shoulder_abduction_mrc':
    case 'arm_raise_over_head':
      applySideRegion(regions, side, 'leftShoulder', 'rightShoulder', intensity, '肩带');
      break;
    case 'biceps':
    case 'elbow_flexion':
      applySideRegion(
        regions,
        side,
        'leftUpperArmFront',
        'rightUpperArmFront',
        intensity,
        '上臂前群',
      );
      break;
    case 'triceps':
      applySideRegion(
        regions,
        side,
        'leftUpperArmBack',
        'rightUpperArmBack',
        intensity,
        '上臂后群',
      );
      break;
    case 'quadriceps':
    case 'knee_extension':
      applySideRegion(regions, side, 'leftThighFront', 'rightThighFront', intensity, '大腿前群');
      break;
    case 'hamstrings':
      applySideRegion(regions, side, 'leftThighBack', 'rightThighBack', intensity, '大腿后群');
      break;
    case 'gluteus':
      applySideRegion(regions, side, 'leftGlute', 'rightGlute', intensity, '臀肌');
      break;
    case 'tibialis':
    case 'ankle_dorsiflexion':
      applySideRegion(regions, side, 'leftShin', 'rightShin', intensity, '小腿前群');
      break;
    case 'eye_closure':
    case 'lip_pursing':
      pushRegion(regions, 'face', intensity, '面肌');
      break;
    default:
      break;
  }
};

export const buildBodyMapFromMeasurements = (measurements: MeasurementLike[]) => {
  const latest = pickLatestMeasurementsByGroup(measurements);
  const regions: BodyRegionMap = {};

  Object.values(latest).forEach((item) => {
    const score = parseStrengthScore(item.strengthScore);
    applyStrengthGroup(
      regions,
      item.metricKey ?? item.muscleGroup,
      item.side ?? 'none',
      scoreToWeaknessIntensity(score),
    );
  });

  return regions;
};

const pickField = (fields: Record<string, string | number> | undefined, keys: string[]) => {
  if (!fields) return undefined;
  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim();
    if (text) return text;
  }
  return undefined;
};

export const buildBodyMapFromFields = (fields?: Record<string, string | number>) => {
  if (!fields) return {};
  const regions: BodyRegionMap = {};
  const scoreKeys: Array<[string, string[]]> = [
    ['deltoid', ['deltoidStrength', 'deltoid_strength']],
    ['biceps', ['bicepsStrength', 'biceps_strength']],
    ['triceps', ['tricepsStrength', 'triceps_strength']],
    ['quadriceps', ['quadricepsStrength', 'quadriceps_strength']],
    ['hamstrings', ['hamstringsStrength', 'hamstrings_strength']],
    ['gluteus', ['gluteusStrength', 'gluteus_strength']],
    ['tibialis', ['tibialisStrength', 'tibialis_strength']],
  ];

  scoreKeys.forEach(([group, keys]) => {
    const raw = pickField(fields, keys);
    const score = parseStrengthScore(raw);
    applyStrengthGroup(regions, group, 'none', scoreToWeaknessIntensity(score));
  });

  return regions;
};

const textContains = (text: string, patterns: string[]) =>
  patterns.some((pattern) => text.includes(pattern));

const inferLateralityIntensity = (
  text: string,
  leftPatterns: string[],
  rightPatterns: string[],
) => {
  const hasLeft = textContains(text, leftPatterns);
  const hasRight = textContains(text, rightPatterns);
  if (hasLeft && hasRight) return { left: 3, right: 3 };
  if (hasLeft) return { left: 4, right: 2 };
  if (hasRight) return { left: 2, right: 4 };
  return { left: 3, right: 3 };
};

export const inferMriBodyMap = (payload: OcrPayloadLike) => {
  const text =
    `${JSON.stringify(payload?.fields ?? {})} ${payload?.extractedText ?? ''}`.toLowerCase();
  const regions: BodyRegionMap = {};
  const findings: string[] = [];

  if (textContains(text, ['前锯', 'serratus'])) {
    pushRegion(regions, 'leftShoulder', 3, '肩带');
    pushRegion(regions, 'rightShoulder', 3, '肩带');
    findings.push('肩带/前锯肌受累');
  }

  if (textContains(text, ['臀', 'glute'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左臀', 'left glute', 'left buttock'],
      ['右臀', 'right glute', 'right buttock'],
    );
    pushRegion(regions, 'leftGlute', laterality.left, '臀肌');
    pushRegion(regions, 'rightGlute', laterality.right, '臀肌');
    findings.push('臀肌受累');
  }

  if (textContains(text, ['大腿后', '腘绳', 'hamstring'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左大腿后', '左腘绳', 'left hamstring'],
      ['右大腿后', '右腘绳', 'right hamstring'],
    );
    pushRegion(regions, 'leftThighBack', laterality.left, '大腿后群');
    pushRegion(regions, 'rightThighBack', laterality.right, '大腿后群');
    findings.push('大腿后群受累');
  }

  if (textContains(text, ['股四头', '大腿前', 'quadriceps'])) {
    pushRegion(regions, 'leftThighFront', 3, '大腿前群');
    pushRegion(regions, 'rightThighFront', 3, '大腿前群');
    findings.push('大腿前群受累');
  }

  if (textContains(text, ['胫前', 'tibialis', '趾长伸', 'extensor'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左胫前', 'left tibialis', '左小腿前'],
      ['右胫前', 'right tibialis', '右小腿前'],
    );
    pushRegion(regions, 'leftShin', laterality.left, '小腿前群');
    pushRegion(regions, 'rightShin', laterality.right, '小腿前群');
    findings.push('小腿前群受累');
  }

  if (textContains(text, ['腓肠', '比目鱼', 'gastrocnemius', 'soleus', '小腿后'])) {
    const laterality = inferLateralityIntensity(
      text,
      ['左腓肠', 'left gastrocnemius', '左小腿后'],
      ['右腓肠', 'right gastrocnemius', '右小腿后'],
    );
    pushRegion(regions, 'leftCalf', laterality.left, '小腿后群');
    pushRegion(regions, 'rightCalf', laterality.right, '小腿后群');
    findings.push('小腿后群受累');
  }

  if (textContains(text, ['面肌', '口轮匝肌', 'facial'])) {
    pushRegion(regions, 'face', 2, '面肌');
    findings.push('面肌受累');
  }

  return {
    regions,
    findings,
    hasFindings: Object.keys(regions).length > 0,
  };
};

export const inferReportKind = (payload: OcrPayloadLike) => {
  const classifiedType = pickField(payload?.fields, [
    'classifiedType',
    'classified_type',
    'reportType',
    'report_type',
    'documentType',
  ]);
  if (classifiedType === 'genetic_report') return 'genetic';
  if (classifiedType === 'muscle_mri' || classifiedType === 'mri') return 'mri';
  if (
    [
      'biochemistry',
      'muscle_enzyme',
      'blood_routine',
      'thyroid_function',
      'coagulation',
      'urinalysis',
      'infection_screening',
      'stool_test',
      'abdominal_ultrasound',
      'blood_panel',
    ].includes(classifiedType ?? '')
  ) {
    return 'lab';
  }
  if (
    ['pulmonary_function', 'diaphragm_ultrasound', 'ecg', 'echocardiography'].includes(
      classifiedType ?? '',
    )
  ) {
    return 'monitoring';
  }
  if (classifiedType === 'physical_exam') return 'strength';

  const text =
    `${JSON.stringify(payload?.fields ?? {})} ${payload?.extractedText ?? ''}`.toLowerCase();
  if (textContains(text, ['d4z4', 'ecori', '4qa', 'southern'])) return 'genetic';
  if (textContains(text, ['mri', '脂肪浸润', '前锯肌', '臀肌', 'hamstring'])) return 'mri';
  if (textContains(text, ['ck', '肌酸激酶', 'ldh', 'mb'])) return 'lab';
  if (textContains(text, ['fvc', '肺功能', 'ecg', 'qtc', 'lvef', 'echo'])) return 'monitoring';
  if (textContains(text, ['肌力', 'mrc', 'deltoid'])) return 'strength';
  return 'general';
};

export const summarizeBodyRegions = (regions: BodyRegionMap, limit = 4) =>
  Object.values(regions)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, limit)
    .map((item) => item.label ?? '受累区域');

export const getBodyHeatColor = (intensity: number, mode: 'strength' | 'mri' = 'strength') => {
  const strengthPalette = ['rgba(140, 199, 232, 0)', '#36617A', '#5D90A9', '#D7A968', '#F37F6B'];
  const mriPalette = ['rgba(240, 177, 107, 0)', '#5A6671', '#A37D61', '#D59A65', '#F37F6B'];
  const palette = mode === 'mri' ? mriPalette : strengthPalette;
  return palette[clamp(intensity, 0, 4)];
};

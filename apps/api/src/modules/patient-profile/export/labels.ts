/**
 * Chinese display names for the enum values this export carries.
 *
 * Every one of these ends up as a `.text` / `display` in a document
 * that has no code beside it — so for those items the label IS the
 * whole meaning, and a sloppy translation is a data error rather than
 * a cosmetic one. They are kept together, in one file, so that the
 * label a receiver sees for `deltoid` cannot differ between the
 * TREAT-NMD alignment and the FHIR bundle.
 *
 * `labelFor` falls back to the raw key rather than to a generic
 * 「其他」: an unmapped key surfacing verbatim is a visible bug, while
 * 「其他」 is a wrong answer that looks like a right one. The enums
 * here are all two-place edits (profile.constants.ts plus a DB CHECK),
 * so a new member arriving unmapped is a real possibility.
 */

export const MUSCLE_GROUP_LABELS: Readonly<Record<string, string>> = {
  deltoid: '三角肌',
  biceps: '肱二头肌',
  triceps: '肱三头肌',
  tibialis: '胫骨前肌',
  quadriceps: '股四头肌',
  hamstrings: '腘绳肌',
  gluteus: '臀肌',
  face: '面部肌群',
  abdominal: '腹部肌群',
};

export const SIDE_LABELS: Readonly<Record<string, string>> = {
  left: '左侧',
  right: '右侧',
  bilateral: '双侧',
  none: '不分左右',
};

export const FUNCTION_TEST_LABELS: Readonly<Record<string, string>> = {
  stair_climb: '爬楼梯计时',
  ten_meter_walk: '10 米步行计时',
  sit_to_stand: '坐立测试',
  six_minute_walk: '6 分钟步行距离',
  timed_up_and_go: '起立行走计时（TUG）',
  custom: '自定义测试',
};

export const SYMPTOM_LABELS: Readonly<Record<string, string>> = {
  fatigue: '疲劳',
  pain: '疼痛',
  dyspnea: '呼吸困难',
  sleep_quality: '睡眠质量',
  anxiety_about_progression: '对疾病进展的焦虑',
};

export const DAILY_IMPACT_LABELS: Readonly<Record<string, string>> = {
  hair_washing: '洗头',
  reaching_up: '上举取物',
  stairs: '上下楼梯',
  dressing: '穿衣',
  walking_outdoors: '户外行走',
};

export const DOCUMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  mri: '磁共振（MRI）报告',
  genetic_report: '基因检测报告',
  blood_panel: '血液检验报告',
  other: '其他医疗文件',
};

/**
 * Follow-up events that are NOT one of the three milestones.
 *
 * They are exported too, because they are the events that mark the
 * course of this disease between milestones — a first fall and a
 * first breathing symptom are what a registry uses to place someone
 * on the trajectory, and dropping them would make the exported record
 * look like a straight line from diagnosis to wheelchair.
 */
export const FOLLOWUP_EVENT_LABELS: Readonly<Record<string, string>> = {
  fall: '跌倒',
  new_foot_drop: '新出现的足下垂',
  new_arm_raise_difficulty: '新出现的抬臂困难',
  new_breathing_discomfort: '新出现的呼吸不适',
  uploaded_report: '上传了新的报告',
  other: '其他事件',
};

export const FOLLOWUP_EVENT_SEVERITY_LABELS: Readonly<Record<string, string>> = {
  mild: '轻',
  moderate: '中',
  severe: '重',
};

export const AMBULATION_LABELS: Readonly<Record<string, string>> = {
  independent: '可独立行走，不需要他人或器具协助',
  assisted: '需要辅助（拐杖、支具、扶人）才能行走',
  unable: '无法行走（含长期使用轮椅、卧床）',
};

export const labelFor = (table: Readonly<Record<string, string>>, key: string): string =>
  table[key] ?? key;

/**
 * THE MOVEMENT A `patient_measurements` ROW RECORDS, when the row does
 * not name a muscle group.
 *
 * WHY A ROW CAN HAVE NO MUSCLE GROUP. `measurementSchema` accepts one —
 * 「metricKey or muscleGroup is required」, not both — and the SHIPPED
 * 用力闭眼 self-test takes that branch on every single submission:
 * `SELF_TEST_ACTIONS[0]` in apps/mobile carries no `muscleGroup` (「Face
 * has no cohort group」) and `buildSelfTestPayload` omits the key
 * entirely. `addMeasurement` then writes the NOT NULL column as
 * `COALESCE($3, 'custom')`.
 *
 * WHAT THE EXPORTS DID WITH IT. `labelFor` falls back to the raw key, so
 * the FHIR Observation went out with `code.text` = 「custom肌力（不分左右）」
 * and the TREAT-NMD item with `muscleGroupLabelZh` = 「custom」 — an MRC
 * grade of 4, correctly dated, attached to a muscle named 「custom」, with
 * `metricKey` (the only thing on the row that says WHAT was tested)
 * carried by neither. And 用力闭眼 is facial strength: the 「facio」 in
 * facioscapulohumeral, usually the first region involved, and the one
 * measurement in this product whose muscle a neurologist most wants
 * named. `labelFor`'s raw-key fallback is doing exactly what its own
 * comment promises — surfacing an unmapped key as a visible bug rather
 * than a plausible wrong answer — and this table is the mapping it was
 * waiting for.
 *
 * The labels are the ones the PATIENT TAPPED (`SELF_TEST_ACTIONS[].label`
 * in apps/mobile/screens/p-data_entry/muscle-self-test.ts), not a
 * re-translation: the exported record should name the action the patient
 * was asked to perform.
 */
export const MEASUREMENT_METRIC_LABELS: Readonly<Record<string, string>> = {
  eye_closure: '用力闭眼',
  lip_pursing: '噘嘴 / 鼓腮',
  arm_raise_over_head: '举手过头',
  elbow_flexion: '屈肘抬物',
  knee_extension: '坐位伸膝',
  ankle_dorsiflexion: '勾脚背',
  shoulder_abduction: '肩外展',
  shoulder_abduction_mrc: '肩外展',
};

/**
 * WHAT A STRENGTH MEASUREMENT MEASURED, for a document that has one
 * text slot to say it in.
 *
 * Three states, and the third one is why this is a function rather than
 * a lookup:
 *
 *   1. A mapped muscle group — 「三角肌肌力」. Unchanged.
 *   2. No mapped group but a mapped movement — 「用力闭眼肌力」. This is
 *      the 用力闭眼 case and it is the common one.
 *   3. Neither maps. `null`, and the callers must then say 「本平台没能
 *      命名这一条测的是哪块肌肉」 rather than print an enum value. A
 *      receiver reading 「custom肌力」 either discards the row or ingests
 *      「custom」 as a body site; both are worse than being told the
 *      platform cannot name it, which is the true statement.
 *
 * The raw keys are NOT swallowed in state 3 — every caller puts them in
 * a note. What is refused is putting them where the muscle goes.
 */
export const measurementSubjectZh = (
  muscleGroup: string | null | undefined,
  metricKey: string | null | undefined,
): string | null => {
  const mapped =
    muscleGroup === null || muscleGroup === undefined
      ? undefined
      : MUSCLE_GROUP_LABELS[muscleGroup];
  if (mapped !== undefined) return `${mapped}肌力`;
  const movement =
    metricKey === null || metricKey === undefined
      ? undefined
      : MEASUREMENT_METRIC_LABELS[metricKey];
  if (movement !== undefined) return `${movement}肌力`;
  return null;
};

/** What a document must say instead, in state 3 above. */
export const UNNAMED_MEASUREMENT_SUBJECT_ZH = '徒手肌力（本平台未能命名所测部位）';

/**
 * The stored `muscle_group` when it is a real muscle group, else null.
 *
 * `patient_measurements.muscle_group` is NOT NULL, so `addMeasurement`
 * writes `COALESCE($3, 'custom')` for the rows that have none — and
 * 「custom」 is not a member of `MUSCLE_GROUPS` nor of migration 022's
 * CHECK set. Publishing it in a machine-readable `muscleGroup` field
 * hands a registry a storage sentinel as an anatomical code; null is the
 * true answer and `metricKey` beside it is the usable one.
 */
export const recognisedMuscleGroup = (muscleGroup: string | null | undefined): string | null =>
  muscleGroup !== null &&
  muscleGroup !== undefined &&
  MUSCLE_GROUP_LABELS[muscleGroup] !== undefined
    ? muscleGroup
    : null;

/**
 * THE MOVEMENT BEHIND A GRADE WHOSE LABEL IS A MUSCLE — state 1 only.
 *
 * 「三角肌肌力 4 级」 obtained by 「举手过头，在家自己做的」 and the same
 * grade obtained by an examiner's hand on the arm are not the same
 * evidence, and `entryMode` says only who did it, not what they tried.
 * Null in state 2, where the label already IS the movement and repeating
 * it would read as a second finding.
 */
export const measurementMovementZh = (
  muscleGroup: string | null | undefined,
  metricKey: string | null | undefined,
): string | null => {
  if (muscleGroup === null || muscleGroup === undefined) return null;
  if (MUSCLE_GROUP_LABELS[muscleGroup] === undefined) return null;
  if (!metricKey) return null;
  return MEASUREMENT_METRIC_LABELS[metricKey] ?? null;
};

/**
 * The raw keys, for the note that accompanies state 3. Kept out of the
 * label so nothing downstream maps 「custom」 as a body site, and kept in
 * the document so the row is still traceable back to its source.
 */
export const unnamedMeasurementNoteZh = (
  muscleGroup: string | null | undefined,
  metricKey: string | null | undefined,
): string =>
  `本平台没能给这一条命名所测的肌肉或动作：档案里这一行记的 muscleGroup 是「${muscleGroup ?? '（空）'}」、metricKey 是「${metricKey ?? '（空）'}」，两者都不在本导出的对照表里。分级本身照原样给出，但在弄清这一行测的是什么之前，请不要把它并入任何肌群的时间序列。`;

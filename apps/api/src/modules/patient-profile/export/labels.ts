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

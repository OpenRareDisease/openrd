import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import Button from '../common/Button';
import { useAppDialog } from '../common/feedback/AppDialog';
import {
  ADMIN_FIELD_ORIGIN_LABEL,
  buildAdminBaselineWrite,
  exportAdminPatient,
  getAdminPatientRecord,
  updateAdminPatientBaseline,
  type AdminFieldOrigin,
  type AdminPatientRecord,
  type AdminPortableExportFormat,
} from '../../lib/admin-api';
import { DIAGNOSIS_LADDER_LABELS, type DiagnosisLadderState } from '../../lib/api';
import { COLOR } from '../../lib/design';
import { ADMIN_FILLED_BASELINE_FIELDS } from '../../lib/legal-updates';
import {
  ADMIN_AUDIT_NOTICE_PATIENT_RECORD,
  AdminBlock,
  AdminOriginChip,
  AdminScreen,
  AdminState,
  describeAdminError,
  formatDate,
  formatDateTime,
} from './common';
import {
  DOWNLOAD_UNSUPPORTED_MESSAGE,
  describeDownloadName,
  downloadStamp,
  isDownloadSupported,
  saveBlobInBrowser,
} from './download';
import styles from './styles';

/**
 * 后台 · 一位患者的档案 — contract §B3 + §B4.
 *
 * THE ONE THING THIS SCREEN EXISTS TO GET RIGHT.
 *
 * §B3: a value an administrator typed must never appear as the
 * patient's own. Every editable field here carries a marker
 * (「无代填记录」/「管理员代填」/「来源不明」), the marker comes from the
 * server's provenance block rather than from anything this screen
 * remembers, and 「来源不明」 is rendered as itself — an entry that
 * exists and cannot be read is NOT the patient's.
 *
 * WHY THE SAVE SENDS THE WHOLE BASELINE.
 *
 * `upsertBaseline` overwrites the entire `baseline_payload` column, and
 * `applyAdminBaselineWrite` derives the changed field set by diffing
 * the stored payload against the incoming one. Sending only the edited
 * fields would therefore read as the administrator clearing everything
 * else. `buildAdminBaselineWrite` in lib/admin-api.ts is the one place
 * that merge happens.
 *
 * WHY THE FORM CAN REFUSE TO OPEN.
 *
 * The payload the patient app reads has been through
 * `applyGeneticReportAutofill`, which fills a missing genetic result
 * or diagnosis year at read time out of the one document the server
 * picks as this profile's genetic evidence. Editing on top of that merge and saving it would persist the
 * inferred diagnosis year into the column under an administrator's
 * name, and would send back genetic values nobody typed — which the
 * server refuses outright, so an operator who came to fix a 备注 would
 * be told they may not fill in a D4Z4. So the form only opens when the
 * server states that what it sent is the stored column
 * (`baselineIsStored`), and says why when it does not.
 */

const YEAR_MIN = 1900;
/** Upper bound for a year field. Computed at render, not baked in: a
 *  literal would quietly start rejecting this year's diagnoses. */
const yearMax = () => new Date().getFullYear();

type FieldKind = 'text' | 'year' | 'multiline';

interface EditableField {
  /** Dotted path — the same key the provenance block uses. */
  path: string;
  label: string;
  hint?: string;
  kind: FieldKind;
  /**
   * The server's own character cap for this field, copied from
   * `baselineProfileSchema` (apps/api/src/modules/patient-profile/
   * profile.schema.ts) — `nullableText(n)` per field, `notes` at 2000.
   *
   * Copied rather than discovered, because the alternative is what
   * happens without it: zod refuses the whole PUT with
   * `{error:'Validation failed'}`, the shared error handler filters the
   * per-field `details` out of the body, and the operator is told
   * 「请求失败 / Validation failed」 with no idea which box is at fault.
   * Year fields have no entry: they are bounded by value (1900..今年),
   * not by length, and that check names its own field.
   */
  maxLength?: number;
}

/**
 * What an administrator may type here, and why it is only this much.
 *
 * Identity and history: what the person is called, where they live,
 * which years they were born and diagnosed in, who else in the family
 * has it, where the weakness started, and a free note. That is what
 * actually gets transcribed off a phone call or a photo of a discharge
 * summary, and it is the whole of what an operator is in a position to
 * know second-hand.
 *
 * Nothing measured is here. The genetic results and the patient's
 * answers about their own body are shown further down, read only, each
 * with its own reason printed beside it rather than left to be
 * inferred from a missing text box.
 *
 * THIS LIST IS A COPY, NOT THE BOUNDARY. `ADMIN_WRITABLE_BASELINE_FIELDS`
 * in apps/api/src/modules/patient-profile/baseline-provenance.ts is the
 * one that is enforced: `applyAdminBaselineWrite` answers 400 for a
 * write that changes anything outside it. The privacy policy's §10（四）
 * promise 「后台只能看，不能替你填」 rests on that, not on this array —
 * a boundary made of which text boxes a screen draws is not a boundary.
 * The two must stay equal; if they diverge, the server wins loudly.
 */
const EDITABLE_FIELDS: EditableField[] = [
  { path: 'foundation.fullName', label: '姓名', kind: 'text', maxLength: 120 },
  { path: 'foundation.preferredName', label: '称呼', kind: 'text', maxLength: 120 },
  {
    path: 'foundation.regionLabel',
    label: '所在地区',
    hint: '例如：四川 成都',
    kind: 'text',
    maxLength: 120,
  },
  { path: 'foundation.birthYear', label: '出生年份', hint: '四位数字', kind: 'year' },
  { path: 'foundation.diagnosisYear', label: '确诊年份', hint: '四位数字', kind: 'year' },
  { path: 'diseaseBackground.familyHistory', label: '家族史', kind: 'text', maxLength: 255 },
  { path: 'diseaseBackground.onsetRegion', label: '起病部位', kind: 'text', maxLength: 120 },
  { path: 'notes', label: '备注', kind: 'multiline', maxLength: 2000 },
];

/**
 * The baseline paths the patient's own form draws a control for.
 *
 * 「患者自己再改一次就把标记拿回去」 is a promise about a screen this one
 * is not, and it is false for the fields that screen has no box for:
 * `applyPatientBaselineWrite` releases a marker only for a leaf path
 * the patient's save CHANGED, and p-register_profile copies the paths
 * it draws no control for forward out of the stored baseline verbatim.
 * No sequence of taps on the patient's form can put those in the
 * changed set, so the marker stays for the life of the account — and
 * it prints on the clinical passport, the PDF, the share page and all
 * three exports.
 *
 * Read off `ADMIN_FILLED_BASELINE_FIELDS` rather than re-listed here.
 * That list is what lib/__tests__/admin-filled-fields.test.tsx renders
 * BOTH screens against — it drives the patient's form and fails when a
 * field marked editable is one the patient's save cannot reach — and
 * admin-filled-fields-parity.test.ts holds its paths to the server's
 * `ADMIN_WRITABLE_BASELINE_FIELDS`. A second copy beside `EDITABLE_FIELDS`
 * would be free to disagree with the form the sentence is about.
 */
const PATIENT_CONTROLLED_PATHS = new Set(
  ADMIN_FILLED_BASELINE_FIELDS.filter((field) => field.patientEditable).map((field) => field.path),
);

/**
 * A read-only field's group: why it has no box here, and what an
 * empty one means.
 *
 * `absent` exists because 未填 is a claim about the patient, and it is
 * the wrong claim for a genetic result. See `GENETIC_ABSENT_NOTE`.
 */
interface ReadonlyGroup {
  reason: string;
  /** The value line when nothing is stored. `null` keeps 未填 — the
   *  patient was asked and did not answer, which is what 未填 says. */
  absent: string | null;
  /** Printed under `absent`, when there is more to an empty row than
   *  the value line can hold. */
  absentNote?: string;
}

/**
 * Why a genetic result has no box here, said to the operator standing
 * in front of the missing box.
 *
 * The value they would type comes off a phone call or a photo, and
 * once it is in the column it is a number a clinical recommendation
 * reads — there is nothing left in it to say a person dictated it.
 * That refusal covers every genetic field alike, and one sentence
 * would say it for all of them.
 *
 * WHAT SPLITS THEM IS THE BOX, not the remedy. 分型 and D4Z4 have one
 * on the patient's own form, so an operator can name a screen he
 * already has and a control that is on it whatever else is true of his
 * record. 单倍型 and 甲基化 have a box nowhere — not here, not there —
 * and that half gets no instruction at all.
 *
 * WHY THAT HALF LOST ITS SCRIPT. It used to end 「让他打开那份报告，点
 * 「识别有误？手动修正」，改完保存。不用让他重新上传一份。」 Whether
 * that works is decided by the report row's `status`: 报告详情 draws the
 * control for `parsed` and `needs_review` and for nothing else, and
 * `patchDocumentOcrFields` answers 409 on the same test. So the script
 * was empty for a report still parsing, one whose parse failed, one the
 * pipeline never touched. This screen prints that same status a few
 * blocks down and still cannot stand behind the sentence: what it holds
 * is the value as of the moment the page loaded, and one tap on
 * 重新识别 moves the row out from under it.
 *
 * WHAT THE STRING MAY NOT DO EITHER is describe where the value came
 * from. The row already carries an origin chip, a legacy marker can
 * still sit on one of these paths, and a sentence saying nothing was
 * recorded would be denying, in the same row, what that chip is
 * displaying. It says where the decision is made and stops, and the
 * phone script in docs/runbooks stops in the same place.
 */
const PATIENT_CAN_TYPE_IT_REASON =
  '这一项后台不能填：电话里听来、照片上认出来的数字，看着像化验结果但不是。' +
  // 「上传基因报告也能带进来」 was the last place on this screen that
  // named the document. The autofill reads whichever document
  // `pickGeneticEvidenceDocument` picks as this profile's genetic
  // evidence, and a 病历摘要 quoting a repeat count is a legitimate
  // pick — so an operator with this sentence in front of him would tell
  // a patient to go and upload a genetics report in order to correct a
  // value that a summary he has already uploaded can carry. The other
  // half of the sentence is the remedy that actually works from here,
  // and it is unchanged.
  '但不是没人能改——患者自己在「我的 → 编辑资料」里有这一项的输入框，他上传的文件里读到了这一项也能带进来。' +
  '要更正，通常请他自己在编辑资料里改最快。';

const NOBODY_CAN_TYPE_IT_REASON =
  '这一项后台没有输入框，患者的「我的 → 编辑资料」里也没有——这一栏里的值，本平台这边现在' +
  '没有人能改，别答应「你告诉我，我帮你改」。' +
  '患者要更正的如果是报告上的读数，那要在那份报告自己的页面上，' +
  '能不能改由那一页按报告当时的状态决定——下面「报告」里的状态只是这一页打开时的快照，' +
  '患者点一次「重新识别」就变了。所以别在电话里说该点哪儿，也别保证一定改得动。';

/**
 * What an EMPTY genetic row means, which is not what 未填 means.
 *
 * This page shows the stored column. The patient's own screens and the
 * export do not: `applyGeneticReportAutofill` fills a missing genetic
 * result out of the one document the server picks as this profile's
 * genetic evidence, on the way out of `getProfileByUserId` and
 * `getBaselineByUserId` — a pick that is not made by upload time, so
 * the document behind a filled value is not necessarily the last one in
 * the list below. So a genetic field
 * can be empty here and printed on his passport at the same time —
 * and for 单倍型 and 甲基化, where nothing writes the column, that is
 * the ordinary case rather than the odd one.
 *
 * An operator reading 未填 off this row tells the patient he never
 * filled it in, about a value he is looking at.
 *
 * IT IS A HEDGE, AND A HEDGE IS FALSE WHERE THE ANSWER IS KNOWN. The
 * fill has exactly one input, an uploaded document, so on a record
 * whose 报告 list came back empty there is nothing that could put a
 * value on the patient's side that is missing here — and this note
 * would be telling the operator not to trust a list this same screen is
 * printing two blocks down. An account that never opened the baseline
 * form is the sharpest case: `getPatientRecord` answers it with no
 * identity and no documents, so there is no patient side for the
 * sentence to be about. `printAbsentNote` is the gate; a record that
 * did not carry the 报告 section at all keeps the note, because then
 * this screen does not know either.
 */
const GENETIC_ABSENT_NOTE =
  // 「最近一份」 was the autofill's old rule. The server now reads the
  // one document it picks as this profile's genetic evidence, and that
  // pick is not by upload time — so the document the operator would
  // have to open is not necessarily the last one in the list. Naming a
  // report at all is what went stale; the instruction that matters is
  // to look at the list rather than at this row, and it is unchanged.
  //
  // AND IT IS NOT ALWAYS A 基因报告 EITHER, which is what this sentence
  // said next. `pickGeneticEvidenceDocument` takes a 病历摘要 quoting
  // the results when the genetics report read out nothing, so the
  // sentence told an operator — in the copy written for what to say on
  // the phone — that a genetic report had supplied a value for a
  // patient who has never uploaded one. What the operator has to do is
  // the same either way, so the clause names 上传的文件 rather than
  // qualifying a claim this screen cannot check.
  '这不代表患者那边也是空的：患者端和导出会用他上传的文件里读到的值补上缺的基因结果，' +
  '这一页只显示基线里存的那一份。所以别在电话里说「你没填」——先看这一页的报告列表。';

/**
 * Whether GENETIC_ABSENT_NOTE is true of the record on screen.
 *
 * `null` is 「this build did not send the 报告 section」 — not 「there are
 * none」 — and the note stays for it: the caution it carries is the
 * right thing to keep where the screen cannot check.
 */
const printAbsentNote = (documents: AdminPatientRecord['documents']): boolean =>
  documents === null || documents.length > 0;

const GENETIC_PATIENT_CAN_TYPE: ReadonlyGroup = {
  reason: PATIENT_CAN_TYPE_IT_REASON,
  absent: '基线里没有',
  absentNote: GENETIC_ABSENT_NOTE,
};

const GENETIC_NOBODY_CAN_TYPE: ReadonlyGroup = {
  reason: NOBODY_CAN_TYPE_IT_REASON,
  absent: '基线里没有',
  absentNote: GENETIC_ABSENT_NOTE,
};

/** Why a patient's answer about their own body has no box. An
 *  unanswered one really is 未填: nothing else fills it in. */
const SELF_REPORT: ReadonlyGroup = {
  reason: '这是患者对自己身体的回答，后台替他填等于替他自述。',
  absent: null,
};

/**
 * Shown but not editable here, each with the group it belongs to.
 *
 * The group's `reason` is printed under the value, per field, rather
 * than as a heading over the block: the reasons differ from row to
 * row, and a heading covering them all leaves the operator to work out
 * which one they are looking at. It is the answer to
 * 「为什么这里没有框」 given where the missing box is.
 */
const READONLY_FIELDS: Array<{ path: string; label: string; group: ReadonlyGroup }> = [
  {
    path: 'diseaseBackground.diagnosisType',
    label: 'FSHD 分型',
    group: GENETIC_PATIENT_CAN_TYPE,
  },
  { path: 'diseaseBackground.d4z4', label: 'D4Z4 重复数', group: GENETIC_PATIENT_CAN_TYPE },
  { path: 'diseaseBackground.haplotype', label: '单倍型', group: GENETIC_NOBODY_CAN_TYPE },
  { path: 'diseaseBackground.methylation', label: '甲基化', group: GENETIC_NOBODY_CAN_TYPE },
  { path: 'diseaseBackground.diagnosisLadder', label: '诊断进展', group: SELF_REPORT },
  {
    path: 'currentStatus.independentlyAmbulatory',
    label: '独立行走',
    group: SELF_REPORT,
  },
  { path: 'currentStatus.armRaiseDifficulty', label: '抬臂困难', group: SELF_REPORT },
  { path: 'currentStatus.facialWeakness', label: '面部无力', group: SELF_REPORT },
  { path: 'currentStatus.footDrop', label: '足下垂', group: SELF_REPORT },
  { path: 'currentStatus.breathingSymptoms', label: '呼吸症状', group: SELF_REPORT },
  { path: 'currentStatus.assistiveDevices', label: '辅具', group: SELF_REPORT },
  { path: 'currentChallenges.fatigue', label: '疲劳', group: SELF_REPORT },
  { path: 'currentChallenges.pain', label: '疼痛', group: SELF_REPORT },
  { path: 'currentChallenges.stairs', label: '上楼梯', group: SELF_REPORT },
  { path: 'currentChallenges.dressing', label: '穿衣', group: SELF_REPORT },
  { path: 'currentChallenges.reachingUp', label: '上举', group: SELF_REPORT },
  {
    path: 'currentChallenges.walkingStability',
    label: '行走稳定性',
    group: SELF_REPORT,
  },
];

/**
 * §B4 导出：单个患者.
 *
 * The three formats `PORTABLE_EXPORT_FORMATS` accepts, with what each
 * one is FOR — an operator picking between them on a phone cannot be
 * expected to know which registry wants which. The server requires the
 * parameter and has no default, so this list is the whole menu.
 */
const EXPORT_FORMATS: Array<{ format: AdminPortableExportFormat; label: string; detail: string }> =
  [
    { format: 'treat-nmd', label: 'TREAT-NMD', detail: '神经肌肉病登记处的对齐导出' },
    { format: 'phenopacket', label: 'Phenopacket', detail: 'GA4GH v2，研究用表型交换' },
    { format: 'fhir-r4', label: 'FHIR R4', detail: '医院信息系统的交换格式' },
  ];

const readPath = (payload: unknown, path: string): unknown => {
  let cursor: unknown = payload;
  for (const part of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

/** A stored value as the text box shows it. `null`/absent is an empty
 *  box; anything that is not a string or a number is NOT put in an
 *  editable box, because saving it back would flatten a structure into
 *  a string. */
const toInputValue = (raw: unknown): string => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
};

const isEditableValue = (raw: unknown): boolean =>
  raw === null ||
  raw === undefined ||
  typeof raw === 'string' ||
  (typeof raw === 'number' && Number.isFinite(raw));

/** Nothing is stored under this path. A blank string counts: it is
 *  what a cleared box leaves behind, and printing it renders a row
 *  with no value and no explanation of why. */
const isAbsentValue = (raw: unknown): boolean =>
  raw === null ||
  raw === undefined ||
  (typeof raw === 'string' && raw.trim() === '') ||
  (Array.isArray(raw) && raw.length === 0);

/** A read-only baseline value in words. Booleans become 是/否 rather
 *  than true/false, and an absent value is 未填 — never 否. */
const formatReadonly = (path: string, raw: unknown): string => {
  if (raw === null || raw === undefined) return '未填';
  if (path === 'diseaseBackground.diagnosisLadder' && typeof raw === 'string') {
    return DIAGNOSIS_LADDER_LABELS[raw as DiagnosisLadderState] ?? raw;
  }
  if (typeof raw === 'boolean') return raw ? '是' : '否';
  if (Array.isArray(raw)) return raw.length === 0 ? '未填' : raw.map(String).join('、');
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
};

/**
 * The line under a marked field.
 *
 * `admin_entered` names who and when, because 「管理员代填」 with no
 * administrator behind it is not an answer to 「谁填的」. `unreadable`
 * says why it could not be read AND repeats that it is not the
 * patient's — the chip alone is a word someone can misremember as
 * 「大概是本人吧」.
 */
const OriginNote = ({ origin }: { origin: AdminFieldOrigin }) => {
  if (origin.state === 'admin_entered') {
    return (
      <Text style={styles.statDetail}>
        {`由 ${origin.adminUserId} 于 ${formatDateTime(origin.at)} 代填`}
      </Text>
    );
  }
  if (origin.state === 'unreadable') {
    return (
      <Text style={styles.statDetail}>
        {`来源记录读不出来：${origin.detail}。它不等于「本人填写」。`}
      </Text>
    );
  }
  return null;
};

/**
 * A read-only label/value line, optionally carrying a provenance
 * marker and the reason the field has no box.
 *
 * When an origin is passed it brings `OriginNote` with it. A marked
 * field must say who and when wherever it is shown — a field that is
 * read-only here can still carry a marker from a profile written
 * earlier, and showing the chip without the administrator behind it
 * answers 「是不是本人填的」 without answering 「谁填的」.
 */
const RecordLine = ({
  label,
  value,
  first,
  origin,
  note,
  reason,
}: {
  label: string;
  value: string;
  first?: boolean;
  origin?: AdminFieldOrigin;
  /** What the value line means, when it does not mean the obvious
   *  thing. Printed above `reason`: the operator's question about an
   *  empty row is 「是空的吗」 before it is 「为什么没有框」. */
  note?: string;
  reason?: string;
}) => (
  <View style={[styles.stat, first ? null : styles.statDivider]}>
    <View style={styles.fieldHead}>
      <Text style={styles.statLabel}>{label}</Text>
      {origin ? <AdminOriginChip origin={origin} /> : null}
    </View>
    <Text style={styles.stateText}>{value}</Text>
    {note ? <Text style={styles.statDetail}>{note}</Text> : null}
    {reason ? <Text style={styles.statDetail}>{reason}</Text> : null}
    {origin ? <OriginNote origin={origin} /> : null}
  </View>
);

const AdminPatientRecordScreen = () => {
  const params = useLocalSearchParams<{ userId?: string }>();
  const userId = typeof params.userId === 'string' ? params.userId : '';
  const { confirm, notify } = useAppDialog();

  const [record, setRecord] = useState<AdminPatientRecord | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The format currently being fetched, so one button says 导出中 and
   *  the other two are refused — two exports of one patient in flight
   *  is two `admin.export` audit rows for one intention. */
  const [exportingFormat, setExportingFormat] = useState<AdminPortableExportFormat | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!userId) {
      setState('error');
      setError(
        new Error('这个链接里没有 userId。患者档案的地址形如 /p-admin_patient?userId=<UUID>。'),
      );
      return;
    }
    const mine = ++seq.current;
    setState('loading');
    getAdminPatientRecord(userId)
      .then((result) => {
        if (mine !== seq.current) return;
        setRecord(result);
        // Drafts are re-seeded from the server on every load, INCLUDING
        // after a save. That is what makes the boxes show what was
        // stored rather than what was typed.
        const seeded: Record<string, string> = {};
        for (const field of EDITABLE_FIELDS) {
          seeded[field.path] = toInputValue(readPath(result.baseline, field.path));
        }
        setDrafts(seeded);
        setSaveError(null);
        setError(null);
        setState('ready');
      })
      .catch((caught: unknown) => {
        if (mine !== seq.current) return;
        setError(caught);
        setState('error');
      });
  }, [userId]);

  useEffect(load, [load]);

  const originByPath = useMemo(() => {
    if (!record?.fieldOrigins) return null;
    const map = new Map<string, AdminFieldOrigin>();
    for (const entry of record.fieldOrigins) map.set(entry.path, entry.origin);
    return map;
  }, [record]);

  /** An absent ENTRY is the patient — see baseline-provenance.ts. An
   *  absent LIST is not: a build that does not send the section tells
   *  us nothing about these values, and 「无代填记录」 would be an
   *  answer we do not have. */
  const originFor = (path: string): AdminFieldOrigin =>
    originByPath === null
      ? { state: 'unreadable', detail: '服务端这一版没有返回字段来源' }
      : (originByPath.get(path) ?? { state: 'patient' });

  const changedPaths = useMemo(() => {
    if (!record) return [];
    return EDITABLE_FIELDS.filter(
      (field) => drafts[field.path] !== toInputValue(readPath(record.baseline, field.path)),
    ).map((field) => field.path);
  }, [drafts, record]);

  const handleSave = async () => {
    if (!record || saving || changedPaths.length === 0) return;

    // Years are validated before anything is sent. A refused save with
    // a reason beats a stored 「19999」 that nobody can tell from a
    // typo the patient made.
    const edits: Record<string, string | number | null> = {};
    for (const field of EDITABLE_FIELDS) {
      if (!changedPaths.includes(field.path)) continue;
      const raw = drafts[field.path]?.trim() ?? '';
      if (raw === '') {
        // An emptied box is an erase, and an erase does NOT leave a
        // marker. `applyAdminBaselineWrite` deletes the entry for a
        // field the write clears, and that is the right behaviour: a
        // marker says 「an administrator entered this value」 and a
        // cleared field has no value to say it about — one left behind
        // would print on the clinical passport as a source for nothing.
        // The erase itself is recorded: `requireAdmin` writes an
        // `admin.record_write` audit row for this request. The three
        // strings on this screen say exactly that; see WHAT CLEARING A
        // FIELD MEANS in
        // apps/api/src/modules/patient-profile/baseline-provenance.ts.
        edits[field.path] = null;
        continue;
      }
      if (field.kind === 'year') {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < YEAR_MIN || parsed > yearMax()) {
          setSaveError(`「${field.label}」要填 ${YEAR_MIN} 到 ${yearMax()} 之间的四位年份。`);
          return;
        }
        edits[field.path] = parsed;
        continue;
      }
      // The box's own `maxLength` stops this being reached by typing.
      // It is reached by editing a value that was ALREADY over the cap
      // — `nullableText` caps arrived after some of these fields did —
      // and the whole PUT would come back 400「Validation failed」with
      // no field named. Refusing here names it.
      if (field.maxLength !== undefined && raw.length > field.maxLength) {
        setSaveError(
          `「${field.label}」最多 ${field.maxLength} 个字，现在是 ${raw.length} 个。服务端会拒绝整次保存，不只是这一个字段。`,
        );
        return;
      }
      edits[field.path] = raw;
    }

    // The version these boxes were filled from. It rides along as
    // If-Match so the server can refuse a save built on a copy the
    // patient has changed since — this payload is the WHOLE baseline,
    // so without that check their newer answer would be written back to
    // the value this page loaded and stamped 管理员代填. Absent means
    // this page cannot name what it is overwriting; the server refuses
    // an unversioned PUT too, so refusing here just says why in words
    // an operator can act on.
    const expectedUpdatedAt = record.identity?.updatedAt ?? null;
    if (!expectedUpdatedAt) {
      setSaveError('这一页没有拿到这份档案的版本号，服务端会拒绝这次保存。请刷新这一页再改一次。');
      return;
    }

    const labels = EDITABLE_FIELDS.filter((field) => changedPaths.includes(field.path)).map(
      (field) => field.label,
    );
    // A cleared field ends up with NO marker — there is no value left to
    // attribute — so the dialog must not promise one for it. The
    // sentence used to say every changed field gets a marker, which was
    // false for exactly this case.
    const clearedLabels = EDITABLE_FIELDS.filter(
      (field) => changedPaths.includes(field.path) && edits[field.path] === null,
    ).map((field) => field.label);
    const markedFields = EDITABLE_FIELDS.filter(
      (field) => changedPaths.includes(field.path) && edits[field.path] !== null,
    );
    const markedLabels = markedFields.map((field) => field.label);
    // Who can take the marker back is decided per field, not per save.
    // The dialog used to end every one of them with 「患者自己再改同一个
    // 字段，标记就回到他名下」, which is an instruction the patient cannot
    // carry out for 称呼 and 备注 — see PATIENT_CONTROLLED_PATHS. An
    // operator who read that sentence off a save of those two would tell
    // the patient on the phone to go and undo it themselves.
    const releasableLabels = markedFields
      .filter((field) => PATIENT_CONTROLLED_PATHS.has(field.path))
      .map((field) => field.label);
    const stuckLabels = markedFields
      .filter((field) => !PATIENT_CONTROLLED_PATHS.has(field.path))
      .map((field) => field.label);

    const ok = await confirm({
      title: '保存到这位患者的档案',
      message:
        `${labels.join('、')} 会写进这个人的档案。` +
        (markedLabels.length > 0
          ? `${markedLabels.join('、')} 会带上一个「管理员代填」标记，标记跟字段一起存进档案里，不只是这块屏幕上的显示。`
          : '') +
        (releasableLabels.length > 0
          ? `${releasableLabels.join('、')} 患者自己在「我的 → 编辑资料」里把同一个字段再改一次，标记就回到他名下。`
          : '') +
        (stuckLabels.length > 0
          ? `${stuckLabels.join('、')} 患者的「编辑资料」里没有这一项的框，他再存一次自己的档案也不会把标记还给他；在这一页把这一格清空能去掉标记，值会跟着一起没。`
          : '') +
        (clearedLabels.length > 0
          ? `${clearedLabels.join('、')} 会被清空。清空不会留下「管理员代填」标记——没有值可以标，留一个标记会在临床护照上显示成「某个不存在的值的来源」。`
          : '') +
        '这次写入会记进审计。',
      confirmLabel: '保存',
      cancelLabel: '取消',
    });
    if (!ok) return;

    setSaving(true);
    setSaveError(null);
    try {
      await updateAdminPatientBaseline(
        userId,
        buildAdminBaselineWrite(record.baseline, edits),
        expectedUpdatedAt,
      );
      // Re-read rather than patching local state: the markers and the
      // stored values on screen after a save must be the server's, not
      // this screen's guess about what the server did with them.
      load();
      notify({ title: '已保存', message: '已重新读取这份档案。', tone: 'success' });
    } catch (caught) {
      const described = describeAdminError(caught);
      setSaveError(`${described.title}：${described.message}`);
    } finally {
      setSaving(false);
    }
  };

  /**
   * One patient, downloaded as a document.
   *
   * `isDownloadSupported()` is checked BEFORE the request, not after:
   * this endpoint writes an `admin.export` audit row against this
   * patient whether or not the bytes ever reach a disk, and an audit
   * trail saying an administrator exported someone — when in fact
   * nothing was saved — is a worse artefact than the missing feature.
   */
  const handleExport = async (format: AdminPortableExportFormat) => {
    if (exportingFormat) return;
    setExportNotice(null);
    setExportError(null);
    if (!isDownloadSupported()) {
      setExportError(DOWNLOAD_UNSUPPORTED_MESSAGE);
      return;
    }
    setExportingFormat(format);
    try {
      const download = await exportAdminPatient(userId, format);
      const { fileName, notice } = describeDownloadName(
        download,
        `openrd-${format}-${userId}-${downloadStamp()}-服务端文件名未收到.json`,
        'patient_export',
      );
      saveBlobInBrowser(download.blob, fileName);
      // The browser's own download indicator is a one-frame toast in
      // some mobile browsers, so the screen says so itself.
      setExportNotice([`已下载 ${fileName}`, notice].filter(Boolean).join('\n'));
    } catch (caught) {
      const described = describeAdminError(caught);
      setExportError(`${described.title}：${described.message}`);
    } finally {
      setExportingFormat(null);
    }
  };

  if (state === 'loading') {
    return (
      <AdminScreen
        title="患者档案"
        subtitle="正在读取。"
        audit={ADMIN_AUDIT_NOTICE_PATIENT_RECORD}
        fallbackHref="/p-admin_patients"
      >
        <AdminState kind="loading" message="加载中…" />
      </AdminScreen>
    );
  }

  if (state === 'error' || !record) {
    const described = describeAdminError(error);
    return (
      <AdminScreen
        title="患者档案"
        subtitle="没能打开这份档案。"
        audit={ADMIN_AUDIT_NOTICE_PATIENT_RECORD}
        fallbackHref="/p-admin_patients"
      >
        <AdminState
          kind="error"
          title={described.title}
          message={described.message}
          onRetry={load}
        />
      </AdminScreen>
    );
  }

  const { account, identity, baseline } = record;

  /**
   * This account registered and never opened the baseline form, so
   * there is no `patient_profiles` row. The record endpoint answers
   * that with `identity: null` rather than a 404, on purpose — 「有账号，
   * 没填过」 is a real state and a 404 would send the operator looking
   * for an account that is right in front of them.
   *
   * THE EDIT FORM MUST NOT OPEN ON IT. `baselineIsStored` is `true` on
   * that branch (correctly — a null baseline IS the stored column), so
   * on that flag alone every box and the 保存 button render, and the
   * save comes back 409 from `AdminController.updatePatientBaseline`
   * (its `if (!stored)` branch in admin.controller.ts): 「这个账号注册后
   * 还没有建过健康档案，后台不能替他建。请让患者本人在 App 里先保存一次
   * 基线」. That sentence
   * is true, and it is still the wrong place to meet it — the screen
   * already says 「这个账号注册后没有建过档案」 two blocks above, so the
   * form would be offering an edit the same screen has said cannot be
   * made. Reaching `ensureProfileForUser`'s 404「Patient profile not
   * found」 from here now means the profile row disappeared between the
   * read and the write, and `describeAdminError` renders THAT as 「这个
   * 账号可能已经注销」 — which for that case is right.
   *
   * The back office cannot create the profile either: `upsertBaseline`
   * only ever ensures an EXISTING row, and the row is created when the
   * patient first opens their own form.
   *
   * `identity`, NOT `baseline`, is the flag. `getPatientRecord` builds
   * `identity` from the profile row and sends `identity: null` on
   * exactly the branch where there is none — both endpoints key off the
   * same `this.deps.admin.getStoredProfile(userId)` returning null, so
   * `identity !== null` is the same condition the 409 tests.
   * `baseline !== null` is a different question: a patient who
   * opened onboarding and never saved a baseline HAS a row, and an
   * administrator transcribing that person's first values off a phone
   * call is the case this screen exists for.
   */
  const hasProfile = identity !== null;
  const canEditBaseline = record.baselineIsStored && hasProfile;

  return (
    <AdminScreen
      title={identity?.fullName ?? identity?.preferredName ?? '未填姓名'}
      subtitle="打开这一页时已经写了一条读取审计记录。下面的手机号没有打码——列表页有。"
      audit={ADMIN_AUDIT_NOTICE_PATIENT_RECORD}
      fallbackHref="/p-admin_patients"
    >
      <AdminBlock title="账号" state="ready">
        <RecordLine first label="手机号" value={account.phoneNumber ?? '未填'} />
        <RecordLine label="邮箱" value={account.email ?? '未填'} />
        <RecordLine label="角色" value={account.role ?? '未知'} />
        <RecordLine
          label="账号状态"
          value={account.isActive === null ? '未知' : account.isActive ? '正常' : '已停用'}
        />
        <RecordLine label="注册时间" value={formatDateTime(account.createdAt) ?? '未知'} />
        <RecordLine label="用户 ID" value={account.userId} />
        {identity ? (
          <>
            <RecordLine label="患者编号" value={identity.patientCode ?? '未填'} />
            <RecordLine label="所在地区" value={identity.regionLabel ?? '未填'} />
            <RecordLine label="档案更新于" value={formatDateTime(identity.updatedAt) ?? '未知'} />
          </>
        ) : (
          <RecordLine label="健康档案" value="这个账号注册后没有建过档案" />
        )}
      </AdminBlock>

      <AdminBlock
        title="基线临床字段"
        note={
          canEditBaseline
            ? '每个字段后面的标记是这个值的来源。空着的框保存后会把这个字段清空——清空不会留下「管理员代填」标记，因为没有值可以标；这次改动本身会进审计记录。'
            : undefined
        }
        state="ready"
      >
        {!hasProfile ? (
          <AdminState
            kind="empty"
            title="这个账号还没有健康档案"
            message={
              '他注册之后一次都没有打开过档案表单，数据库里没有他的 patient_profiles 行，所以没有基线可以改。' +
              '后台也建不了这一行——它是患者本人第一次打开自己的档案时创建的。' +
              '需要的话请让他先在 App 里填一次，或者由你在电话里带着他填。'
            }
          />
        ) : null}

        {hasProfile && !record.baselineIsStored ? (
          <AdminState
            kind="error"
            title="这份基线不能在这里编辑"
            message={
              // 「从最近一份报告里补上」 was the autofill's old rule and
              // is no longer what it does: it reads the one document
              // the server picks as this profile's genetic evidence,
              // which is not chosen by upload time, and which is not
              // always a 基因报告 — the picker takes a 病历摘要 quoting
              // the results when the genetics report read out nothing.
              // Which document it is does not change what this notice
              // is for — the baseline on screen may be an autofilled
              // one either way — so the clause names 上传的文件 and
              // stops, and what stays is the part an administrator has
              // to act on.
              '服务端没有说明它给出的 baseline 是数据库里那一列本身。' +
              '患者端读到的那份经过了自动补全（缺的基因结果和确诊年份会从一份已上传的文件里补上），' +
              '在那份上面改再存回去，等于把推断出来的值以管理员的名义写进库里。所以这里只读。'
            }
          />
        ) : null}

        {EDITABLE_FIELDS.map((field, index) => {
          const stored = readPath(baseline, field.path);
          const locked = !canEditBaseline || !isEditableValue(stored);
          return (
            <View key={field.path} style={[styles.field, index === 0 ? null : styles.statDivider]}>
              <View style={styles.fieldHead}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                <AdminOriginChip origin={originFor(field.path)} />
              </View>
              {locked ? (
                <Text style={styles.statMissing}>
                  {isEditableValue(stored)
                    ? formatReadonly(field.path, stored)
                    : `这个字段现在存的是一个结构（${formatReadonly(field.path, stored)}），不能当文本改。`}
                </Text>
              ) : (
                <TextInput
                  style={[styles.input, field.kind === 'multiline' ? styles.multilineInput : null]}
                  value={drafts[field.path] ?? ''}
                  onChangeText={(text) =>
                    setDrafts((current) => ({ ...current, [field.path]: text }))
                  }
                  placeholder={field.hint ?? '未填'}
                  placeholderTextColor={COLOR.inkFaint}
                  multiline={field.kind === 'multiline'}
                  maxLength={field.maxLength}
                  keyboardType={field.kind === 'year' ? 'number-pad' : 'default'}
                  accessibilityLabel={`${field.label}（${ADMIN_FIELD_ORIGIN_LABEL[originFor(field.path).state]}）`}
                  editable={!saving}
                />
              )}
              <OriginNote origin={originFor(field.path)} />
            </View>
          );
        })}

        {saveError ? (
          <Text style={[styles.stateText, styles.statValueAlert]}>{saveError}</Text>
        ) : null}

        {canEditBaseline ? (
          <View style={styles.field}>
            <Button
              label={changedPaths.length === 0 ? '没有改动' : `保存 ${changedPaths.length} 处改动`}
              variant="prominent"
              fullWidth
              busy={saving}
              disabled={changedPaths.length === 0}
              onPress={() => void handleSave()}
            />
          </View>
        ) : null}
      </AdminBlock>

      <AdminBlock
        title="其余基线字段（只读）"
        note="这些字段后台只能看。每一条下面写了它为什么不能在这里改。服务端也会拒绝：改动它们的请求会被 400 挡回来，并且会点名是哪几个字段——挡住它们的不是这一页没画输入框。"
        state="ready"
      >
        {READONLY_FIELDS.map((field, index) => {
          const stored = readPath(baseline, field.path);
          const absent = isAbsentValue(stored);
          return (
            <RecordLine
              key={field.path}
              first={index === 0}
              label={field.label}
              value={
                absent && field.group.absent !== null
                  ? field.group.absent
                  : formatReadonly(field.path, stored)
              }
              note={
                absent && printAbsentNote(record.documents) ? field.group.absentNote : undefined
              }
              origin={originFor(field.path)}
              reason={field.group.reason}
            />
          );
        })}
      </AdminBlock>

      <AdminBlock title="报告" state="ready">
        {record.documents === null ? (
          <Text style={styles.statMissing}>服务端没有返回这一项。</Text>
        ) : record.documents.length === 0 ? (
          <Text style={styles.statMissing}>没有报告。</Text>
        ) : (
          record.documents.map((document, index) => (
            <View
              key={document.id}
              style={[styles.historyRow, index === 0 ? null : styles.statDivider]}
            >
              <Text style={styles.historyTitle}>{document.title ?? '未命名报告'}</Text>
              <Text style={styles.historyMeta}>
                {[document.documentType, document.status, formatDate(document.uploadedAt)]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))
        )}
      </AdminBlock>

      <AdminBlock title="随访事件" state="ready">
        {record.followups === null ? (
          <Text style={styles.statMissing}>服务端没有返回这一项。</Text>
        ) : record.followups.length === 0 ? (
          <Text style={styles.statMissing}>没有随访记录。</Text>
        ) : (
          record.followups.map((event, index) => (
            <View
              key={event.id}
              style={[styles.historyRow, index === 0 ? null : styles.statDivider]}
            >
              <Text style={styles.historyTitle}>{event.eventType ?? '未标类型'}</Text>
              <Text style={styles.historyMeta}>
                {[event.severity, formatDate(event.occurredAt)].filter(Boolean).join(' · ')}
              </Text>
              {event.description ? (
                <Text style={styles.historyMeta}>{event.description}</Text>
              ) : null}
            </View>
          ))
        )}
      </AdminBlock>

      <AdminBlock title="跌倒" state="ready">
        {record.falls === null ? (
          <Text style={styles.statMissing}>服务端没有返回这一项。</Text>
        ) : record.falls.length === 0 ? (
          <Text style={styles.statMissing}>没有跌倒记录。</Text>
        ) : (
          record.falls.map((fall, index) => (
            <View
              key={fall.id}
              style={[styles.historyRow, index === 0 ? null : styles.statDivider]}
            >
              <Text style={styles.historyTitle}>{formatDate(fall.occurredOn) ?? '未填日期'}</Text>
              {/* 未填 and 没受伤 are different answers about a body. */}
              <Text style={styles.historyMeta}>
                {fall.injured === null ? '是否受伤：未填' : fall.injured ? '受伤' : '没受伤'}
              </Text>
            </View>
          ))
        )}
      </AdminBlock>

      <AdminBlock title="量表" state="ready">
        {record.instruments === null ? (
          <Text style={styles.statMissing}>服务端没有返回这一项。</Text>
        ) : record.instruments.length === 0 ? (
          <Text style={styles.statMissing}>没有量表记录。</Text>
        ) : (
          record.instruments.map((item, index) => (
            <View
              key={item.id}
              style={[styles.historyRow, index === 0 ? null : styles.statDivider]}
            >
              <Text style={styles.historyTitle}>{item.instrumentNameZh ?? '未命名量表'}</Text>
              <Text style={styles.historyMeta}>
                {[
                  item.scoredValue === null ? null : `分级 ${item.scoredValue}`,
                  item.levelLabelZh,
                  formatDate(item.administeredAt),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          ))
        )}
      </AdminBlock>

      <AdminBlock
        title="导出"
        note="把这一位患者导成一份标准格式的文档，浏览器直接下载。每次导出都会写一条 admin.export 审计记录，文件名由服务端给，里面带时间戳和你的账号 ID。"
        state="ready"
      >
        {hasProfile ? (
          <>
            {EXPORT_FORMATS.map((entry, index) => (
              <View
                key={entry.format}
                style={[styles.field, index === 0 ? null : styles.statDivider]}
              >
                <Text style={styles.statLabel}>{entry.label}</Text>
                <Text style={styles.blockNote}>{entry.detail}</Text>
                <Button
                  label={exportingFormat === entry.format ? '导出中…' : `导出 ${entry.label}`}
                  variant="tinted"
                  fullWidth
                  busy={exportingFormat === entry.format}
                  disabled={exportingFormat !== null}
                  onPress={() => void handleExport(entry.format)}
                />
              </View>
            ))}
            <View style={[styles.field, styles.statDivider]}>
              {/* What an operator has to have before handing one of
                  these to a hospital or a registry. */}
              {/* 「从他已上传的基因报告里」 was the same over-claim the
                  两 notices above carried: the document the server reads
                  as a profile's genetic evidence is a 病历摘要 quoting
                  the results whenever the genetics report read out
                  nothing, and this line is what an operator checks
                  before handing the file to a hospital. */}
              <Text style={styles.blockNote}>
                文件里的基线字段是患者端读到的那一份：缺的基因结果和确诊年份会从他已上传的文件里自动补上，所以可能和上面编辑框里的原值不一样——编辑框里是数据库存的原值。
              </Text>
              <Text style={styles.blockNote}>
                三种格式都不写姓名、电话、住址，家族史也不外发（那是他关于亲属的陈述，亲属没有为这次导出同意过）。文件里的
                omissions
                是写给接收方看的「这个位置为什么是空的」，但三种格式不是都为这两项写了说明，所以别指望接收方能从文件本身看出它们是按规则不发、而不是这个人没有——需要的话请你另行说明。
              </Text>
            </View>
            {exportNotice ? <Text style={styles.stateText}>{exportNotice}</Text> : null}
            {exportError ? (
              <Text style={[styles.stateText, styles.statValueAlert]}>{exportError}</Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.statMissing}>
            这个账号还没有健康档案，没有可导出的内容。服务端会用 404 拒绝这次导出。
          </Text>
        )}
      </AdminBlock>
    </AdminScreen>
  );
};

export default AdminPatientRecordScreen;

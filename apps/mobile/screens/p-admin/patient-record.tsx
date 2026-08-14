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
import {
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
 * (「本人填写」/「管理员代填」/「来源不明」), the marker comes from the
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
 * `applyGeneticReportAutofill`, which fills a missing D4Z4 or
 * diagnosis year out of the patient's latest genetic report at read
 * time. Editing on top of that merge and saving it would persist
 * inferred values into the column under an administrator's name. So
 * the form only opens when the server states that what it sent is the
 * stored column (`baselineIsStored`), and says why when it does not.
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
   * 「请求失败 / Validation failed」 with no idea which of twelve boxes
   * is at fault. Year fields have no entry: they are bounded by value
   * (1900..今年), not by length, and that check names its own field.
   */
  maxLength?: number;
}

/**
 * What an administrator may type here, and why it is only this much.
 *
 * These are the fields that actually get transcribed off a phone call
 * or a photo of a discharge summary. The rest of the baseline —
 * 诊断阶梯, the 现状 booleans, the 困难 scores — is a form the patient
 * answers about their own body, and a back office filling those in
 * would be inventing self-report. They are shown further down, read
 * only, with that said on screen rather than left to be inferred from
 * a missing text box.
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
  {
    path: 'diseaseBackground.diagnosisType',
    label: 'FSHD 分型',
    hint: '例如：FSHD1',
    kind: 'text',
    maxLength: 40,
  },
  {
    path: 'diseaseBackground.d4z4',
    label: 'D4Z4 重复数',
    hint: '例如：4/22',
    kind: 'text',
    maxLength: 80,
  },
  {
    path: 'diseaseBackground.haplotype',
    label: '单倍型',
    hint: '例如：4qA',
    kind: 'text',
    maxLength: 40,
  },
  {
    path: 'diseaseBackground.methylation',
    label: '甲基化',
    hint: '例如：12%',
    kind: 'text',
    maxLength: 80,
  },
  { path: 'diseaseBackground.familyHistory', label: '家族史', kind: 'text', maxLength: 255 },
  { path: 'diseaseBackground.onsetRegion', label: '起病部位', kind: 'text', maxLength: 120 },
  { path: 'notes', label: '备注', kind: 'multiline', maxLength: 2000 },
];

/** Shown but not editable here. Label only — the value is formatted
 *  below. */
const READONLY_FIELDS: Array<{ path: string; label: string }> = [
  { path: 'diseaseBackground.diagnosisLadder', label: '诊断进展' },
  { path: 'currentStatus.independentlyAmbulatory', label: '独立行走' },
  { path: 'currentStatus.armRaiseDifficulty', label: '抬臂困难' },
  { path: 'currentStatus.facialWeakness', label: '面部无力' },
  { path: 'currentStatus.footDrop', label: '足下垂' },
  { path: 'currentStatus.breathingSymptoms', label: '呼吸症状' },
  { path: 'currentStatus.assistiveDevices', label: '辅具' },
  { path: 'currentChallenges.fatigue', label: '疲劳' },
  { path: 'currentChallenges.pain', label: '疼痛' },
  { path: 'currentChallenges.stairs', label: '上楼梯' },
  { path: 'currentChallenges.dressing', label: '穿衣' },
  { path: 'currentChallenges.reachingUp', label: '上举' },
  { path: 'currentChallenges.walkingStability', label: '行走稳定性' },
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

/** A read-only label/value line, optionally carrying a provenance
 *  marker. */
const RecordLine = ({
  label,
  value,
  first,
  origin,
}: {
  label: string;
  value: string;
  first?: boolean;
  origin?: AdminFieldOrigin;
}) => (
  <View style={[styles.stat, first ? null : styles.statDivider]}>
    <View style={styles.fieldHead}>
      <Text style={styles.statLabel}>{label}</Text>
      {origin ? <AdminOriginChip origin={origin} /> : null}
    </View>
    <Text style={styles.stateText}>{value}</Text>
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
   *  us nothing about who typed these values, and 「本人填写」 is the
   *  one answer we may not guess. */
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
    const markedLabels = labels.filter((label) => !clearedLabels.includes(label));

    const ok = await confirm({
      title: '保存到这位患者的档案',
      message:
        `${labels.join('、')} 会写进这个人的档案。` +
        (markedLabels.length > 0
          ? `${markedLabels.join('、')} 会带上一个「管理员代填」标记，标记跟字段一起存进档案里，不只是这块屏幕上的显示。患者自己再改同一个字段，标记就回到他名下。`
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
      <AdminScreen title="患者档案" subtitle="正在读取。" fallbackHref="/p-admin_patients">
        <AdminState kind="loading" message="加载中…" />
      </AdminScreen>
    );
  }

  if (state === 'error' || !record) {
    const described = describeAdminError(error);
    return (
      <AdminScreen title="患者档案" subtitle="没能打开这份档案。" fallbackHref="/p-admin_patients">
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
              '服务端没有说明它给出的 baseline 是数据库里那一列本身。' +
              '患者端读到的那份经过了基因报告自动补全（D4Z4、单倍型、确诊年份会从最近一份报告里补上），' +
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
        note="这些是患者对自己身体的回答。后台代填它们等于替患者自述，所以这里只显示。服务端也会拒绝：改动这些字段的请求会被 400 挡回来，不是靠这一页没画输入框。"
        state="ready"
      >
        {READONLY_FIELDS.map((field, index) => (
          <RecordLine
            key={field.path}
            first={index === 0}
            label={field.label}
            value={formatReadonly(field.path, readPath(baseline, field.path))}
            origin={originFor(field.path)}
          />
        ))}
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
              <Text style={styles.blockNote}>
                文件里的基线字段是患者端读到的那一份：缺的
                D4Z4、单倍型、确诊年份会从他最近一份基因报告里自动补上，所以可能和上面编辑框里的原值不一样——编辑框里是数据库存的原值。
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

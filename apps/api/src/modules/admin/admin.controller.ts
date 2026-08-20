import type { Response } from 'express';

import { FULL_EXPORT_COLUMNS, buildFullExportCsv, buildFullExportFileName } from './admin.csv.js';
import {
  adminUserIdParamsSchema,
  aiUsageQuerySchema,
  fullExportBodySchema,
  parseFailureQuerySchema,
  patientExportQuerySchema,
  patientListQuerySchema,
} from './admin.schema.js';
import { FULL_EXPORT_MAX_ROWS, type AdminService } from './admin.service.js';
import type { AppLogger } from '../../config/logger.js';
import { _auditPathOf } from '../../middleware/require-admin.js';
import type { AuthenticatedRequest } from '../../middleware/require-auth.js';
import type { HealthSummary } from '../../routes/index.js';
import { AppError } from '../../utils/app-error.js';
import {
  applyAdminBaselineWrite,
  leafPaths,
  listBaselineFieldOrigins,
} from '../patient-profile/baseline-provenance.js';
import type { ExportFieldOrigin } from '../patient-profile/export/envelope.js';
import { buildPortableExport } from '../patient-profile/export/index.js';
import type { FallsService } from '../patient-profile/falls/falls.service.js';
import type { InstrumentsService } from '../patient-profile/instruments/instruments.service.js';
import type { BaselineProfileInput } from '../patient-profile/profile.schema.js';
import { baselineProfileSchema } from '../patient-profile/profile.schema.js';
import type { PatientProfileService } from '../patient-profile/profile.service.js';

export interface AdminControllerDeps {
  admin: AdminService;
  profiles: PatientProfileService;
  falls: FallsService;
  instruments: InstrumentsService;
  /** Injected rather than imported so that this module does not import
   *  routes/index.ts, which imports the router that constructs this
   *  controller. The type is imported (types are erased, so no cycle);
   *  the function is passed in at mount time. */
  healthSummary: () => Promise<HealthSummary>;
  /**
   * `OCR_STUCK_AFTER_MINUTES`, passed in rather than imported.
   *
   * The constant lives in profile.controller.ts, which imports the
   * OpenAI client at module scope; importing it here would put that
   * package in the dependency graph of every admin unit test for the
   * sake of the number 10. admin.routes.ts imports it from its one
   * definition and hands it over, so the parse-failure queue and the
   * recovery sweep still judge「卡住」by the same threshold.
   */
  ocrStuckAfterMinutes: number;
  logger: AppLogger;
}

/**
 * The tokens an export has to carry for a marked profile to leave
 * this endpoint, one per origin STATE.
 *
 * Typed as `ExportFieldOrigin['state']` rather than written out as bare
 * strings, so a renamed state cannot leave the guard looking for a word
 * nothing writes any more. It is the EXPORT's vocabulary and not
 * `BASELINE_FIELD_SOURCES`, because what is searched for is what the
 * document says, and the lists are different: the source is the
 * word stored in the profile, the state is what a reader made of it.
 *
 * `BaselineFieldOrigin` collapses every member of
 * `BASELINE_FIELD_SOURCES` onto the one `admin_entered` state
 * (`parseEntry` in baseline-provenance.ts accepts any member and
 * returns that state), so a second source added there — the clinician
 * or registry import that module anticipates — arrives here as this
 * state and is covered by this check. It would also be DESCRIBED as
 * 管理员代填 by the sentence below, which is that collapse and not
 * something this guard can undo: a second source needs its own state
 * in baseline-provenance.ts before anything downstream can tell the two
 * apart.
 */
const ADMIN_ENTERED_STATE: ExportFieldOrigin['state'] = 'admin_entered';
const UNREADABLE_STATE: ExportFieldOrigin['state'] = 'unreadable';

/**
 * Today in Asia/Shanghai, as `YYYY-MM-DD`.
 *
 * The operator is in China and the server clock may be UTC. With a UTC
 * date the confirmation phrase would change under the operator at 08:00
 * local — the middle of a working morning — while a Shanghai date rolls
 * over at local midnight, when nobody is exporting the database.
 */
const shanghaiDate = (at: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(at);

/**
 * The exact string the operator has to send back to get the file.
 *
 * WHAT THIS DOES: it rules out the whole class of「导出全了？我只是点了一下」
 * — a bookmarked URL, a double submit, a link somebody clicked, a
 * replayed request from yesterday, a GET from a crawler. The phrase
 * cannot be produced without first making the request that returns it,
 * and it carries the row count, so an operator cannot type it without
 * having been told how many patients they are about to take.
 *
 * WHAT IT DOES NOT DO: it is not authentication and it is not a
 * capability. Anyone who can reach this endpoint as an administrator
 * can obtain the phrase by asking for it. The controls that decide WHO
 * may do this are `requireAdmin`'s role check and `npm run admin:grant`;
 * the controls that make it visible afterwards are the audit rows
 * and the operator's id in the filename.
 */
export const buildFullExportConfirmation = (patientCount: number, at: Date): string =>
  `确认导出全部 ${patientCount} 位患者的完整数据 ${shanghaiDate(at)}`;

/**
 * WHICH TIER OF THE DISCLOSURE A COLUMN BELONGS TO.
 *
 * `identifying` is not 「personal data」 — every column in this file is
 * that. It is the narrower question the operator is actually deciding:
 * DOES THIS COLUMN, BY ITSELF, TURN A ROW BACK INTO A PERSON, OR NAME
 * SOMEBODY WHO IS NOT THE PATIENT. So it holds the direct identifiers
 * and contact details, the quasi-identifiers that re-identify in
 * combination (an exact birth date, a sex, a district), the two
 * free-text boxes — which hold whatever somebody typed, including
 * names — and the two columns about a THIRD PARTY: the treating
 * physician, and the patient's account of their relatives.
 */
type FullExportColumnTier = 'identifying' | 'clinical';

/**
 * How each full-export column is named to the operator on the 428
 * screen, in the words on their own screens rather than as the
 * snake_case headers the file carries.
 *
 * A COLUMN THAT IS NOT IN THIS MAP IS DISCLOSED AS `identifying`,
 * UNDER ITS RAW HEADER. That fallback is the whole point of the map
 * existing beside `FULL_EXPORT_COLUMNS` rather than the sentence being
 * written out by hand: a column added to admin.csv.ts by somebody who
 * never opens this file cannot land outside the disclosure, and it
 * fails towards being named rather than towards being hidden. The raw
 * header is honest where an invented Chinese label would not be —
 * same reasoning as `baselineFieldLabelZh`.
 *
 * WHAT WAS WRONG BEFORE. The note was one hand-written sentence —
 * 「这份文件包含全部患者的姓名、手机号、所在地区与全部基线临床字段」 —
 * with no 等 in it, so it read as a LIST and not as examples. The file
 * it described has 71 columns, and the sentence named none of
 * `date_of_birth` (the exact day, which the AI pipeline hard-deletes as
 * identifying), `email`, `contact_email`, `contact_phone`,
 * `primary_physician` (a person who is not the patient), or the two
 * free-text columns `baseline_notes` and `profile_notes`. An operator
 * who confirmed it had been told the file was less identifying than it
 * is, on the action this file's own header calls THE MOST DANGEROUS
 * ACTION IN THE PRODUCT.
 */
const FULL_EXPORT_COLUMN_DISCLOSURE = new Map<
  string,
  { tier: FullExportColumnTier; labelZh: string }
>([
  ['user_id', { tier: 'identifying', labelZh: '账号 ID' }],
  ['profile_id', { tier: 'identifying', labelZh: '档案 ID' }],
  ['patient_code', { tier: 'identifying', labelZh: '患者编号' }],
  ['phone_number', { tier: 'identifying', labelZh: '手机号' }],
  ['email', { tier: 'identifying', labelZh: '注册邮箱' }],
  ['full_name', { tier: 'identifying', labelZh: '姓名' }],
  ['preferred_name', { tier: 'identifying', labelZh: '称呼' }],
  ['date_of_birth', { tier: 'identifying', labelZh: '出生日期（精确到日）' }],
  ['gender', { tier: 'identifying', labelZh: '性别' }],
  ['contact_phone', { tier: 'identifying', labelZh: '联系人电话' }],
  ['contact_email', { tier: 'identifying', labelZh: '联系邮箱' }],
  ['primary_physician', { tier: 'identifying', labelZh: '主治医生姓名（患者之外的另一个人）' }],
  ['region_province', { tier: 'identifying', labelZh: '省' }],
  ['region_city', { tier: 'identifying', labelZh: '市' }],
  ['region_district', { tier: 'identifying', labelZh: '区县' }],
  ['baseline_region_label', { tier: 'identifying', labelZh: '基线里填的所在地区' }],
  ['diagnosis_date', { tier: 'identifying', labelZh: '确诊日期（精确到日）' }],
  ['baseline_family_history', { tier: 'identifying', labelZh: '家族史（关于亲属的自述）' }],
  ['baseline_notes', { tier: 'identifying', labelZh: '基线备注（自由文本，里面可能有任何内容）' }],
  ['profile_notes', { tier: 'identifying', labelZh: '档案备注（自由文本，里面可能有任何内容）' }],

  ['account_role', { tier: 'clinical', labelZh: '账号角色' }],
  ['account_is_active', { tier: 'clinical', labelZh: '账号是否启用' }],
  ['account_created_at', { tier: 'clinical', labelZh: '账号注册时间' }],
  ['height_cm', { tier: 'clinical', labelZh: '身高' }],
  ['weight_kg', { tier: 'clinical', labelZh: '体重' }],
  ['blood_type', { tier: 'clinical', labelZh: '血型' }],
  ['diagnosis_stage', { tier: 'clinical', labelZh: '诊断阶段' }],
  ['genetic_mutation', { tier: 'clinical', labelZh: '基因突变（档案字段）' }],
  ['baseline_birth_year', { tier: 'clinical', labelZh: '基线出生年份' }],
  ['baseline_age_band', { tier: 'clinical', labelZh: '基线年龄段' }],
  ['baseline_diagnosis_year', { tier: 'clinical', labelZh: '基线确诊年份' }],
  ['baseline_diagnosis_ladder', { tier: 'clinical', labelZh: '诊断进展' }],
  ['baseline_diagnosed_fshd', { tier: 'clinical', labelZh: '是否确诊 FSHD' }],
  ['baseline_diagnosis_type', { tier: 'clinical', labelZh: 'FSHD 分型' }],
  ['baseline_d4z4', { tier: 'clinical', labelZh: 'D4Z4 重复数' }],
  ['baseline_haplotype', { tier: 'clinical', labelZh: '单倍型' }],
  ['baseline_methylation', { tier: 'clinical', labelZh: '甲基化' }],
  ['baseline_onset_region', { tier: 'clinical', labelZh: '起病部位' }],
  ['baseline_independently_ambulatory', { tier: 'clinical', labelZh: '独立行走' }],
  ['baseline_arm_raise_difficulty', { tier: 'clinical', labelZh: '抬臂困难' }],
  ['baseline_facial_weakness', { tier: 'clinical', labelZh: '面部无力' }],
  ['baseline_foot_drop', { tier: 'clinical', labelZh: '足下垂' }],
  ['baseline_breathing_symptoms', { tier: 'clinical', labelZh: '呼吸症状' }],
  ['baseline_assistive_devices', { tier: 'clinical', labelZh: '辅具' }],
  ['baseline_challenge_fatigue', { tier: 'clinical', labelZh: '疲劳' }],
  ['baseline_challenge_pain', { tier: 'clinical', labelZh: '疼痛' }],
  ['baseline_challenge_stairs', { tier: 'clinical', labelZh: '上楼梯' }],
  ['baseline_challenge_dressing', { tier: 'clinical', labelZh: '穿衣' }],
  ['baseline_challenge_reaching_up', { tier: 'clinical', labelZh: '上举' }],
  ['baseline_challenge_walking_stability', { tier: 'clinical', labelZh: '行走稳定性' }],
  ['admin_entered_baseline_fields', { tier: 'clinical', labelZh: '管理员代填的字段清单' }],
  [
    'unreadable_provenance_baseline_fields',
    { tier: 'clinical', labelZh: '来源读不出来的字段清单' },
  ],
  ['ai_consent_personal', { tier: 'clinical', labelZh: 'AI 个人数据同意' }],
  ['ai_consent_third_party', { tier: 'clinical', labelZh: 'AI 第三方信息同意' }],
  ['ai_consent_precise_values', { tier: 'clinical', labelZh: '精确数值同意' }],
  ['clinical_trial_consent', { tier: 'clinical', labelZh: '临床试验同意' }],
  ['data_donation_consent', { tier: 'clinical', labelZh: '数据捐献同意' }],
  ['hospital_sync_consent', { tier: 'clinical', labelZh: '医院同步同意' }],
  ['community_share_consent', { tier: 'clinical', labelZh: '社区分享同意' }],
  ['count_measurements', { tier: 'clinical', labelZh: '肌力测量条数' }],
  ['count_function_tests', { tier: 'clinical', labelZh: '功能测试条数' }],
  ['count_symptom_scores', { tier: 'clinical', labelZh: '症状评分条数' }],
  ['count_daily_impacts', { tier: 'clinical', labelZh: '日常影响条数' }],
  ['count_followup_events', { tier: 'clinical', labelZh: '随访事件条数' }],
  ['count_activity_logs', { tier: 'clinical', labelZh: '活动记录条数' }],
  ['count_documents', { tier: 'clinical', labelZh: '报告条数' }],
  ['count_medications', { tier: 'clinical', labelZh: '用药条数' }],
  ['count_falls', { tier: 'clinical', labelZh: '跌倒条数' }],
  ['count_instrument_administrations', { tier: 'clinical', labelZh: '量表施测条数' }],
  ['profile_created_at', { tier: 'clinical', labelZh: '档案创建时间' }],
  ['profile_updated_at', { tier: 'clinical', labelZh: '档案更新时间' }],
]);

/**
 * WHAT THE FILE CONTAINS, DERIVED FROM THE COLUMNS THAT WILL BE IN IT.
 *
 * The 428 screen renders these strings verbatim — `state.notes.map` in
 * apps/mobile/screens/p-admin/full-export.tsx — so what is written here
 * is what an operator reads before deciding, and no client is in a
 * position to correct it.
 *
 * EVERY COLUMN IS NAMED. Not summarised, not sampled, and with no 等 on
 * the end: an enumeration that is short is worse than no enumeration,
 * because a reader takes it for the whole list. The identifying tier
 * goes first and alone, because that is the part the decision turns on;
 * the rest follows so that the two counts add up to the width of the
 * file, which is what makes it checkable that nothing was left out.
 *
 * Takes the columns as an argument, defaulting to the real list, so a
 * test can hand it a column the map has never seen and read what the
 * operator would be shown.
 */
export const buildFullExportDisclosureNotes = (
  columns: ReadonlyArray<{ header: string }> = FULL_EXPORT_COLUMNS,
): string[] => {
  const identifying: string[] = [];
  const clinical: string[] = [];
  for (const { header } of columns) {
    const disclosure = FULL_EXPORT_COLUMN_DISCLOSURE.get(header);
    if (!disclosure) {
      identifying.push(header);
      continue;
    }
    (disclosure.tier === 'identifying' ? identifying : clinical).push(disclosure.labelZh);
  }

  const notes: string[] = [
    `这份文件每一行是一位患者，一共 ${columns.length} 列，下面把每一列都列出来。`,
  ];
  if (identifying.length > 0) {
    notes.push(
      `其中 ${identifying.length} 列能把一行还原成具体的人，或者写着患者之外的另一个人：${identifying.join(
        '、',
      )}。`,
    );
  }
  if (clinical.length > 0) {
    notes.push(`另外 ${clinical.length} 列是临床与账号内容：${clinical.join('、')}。`);
  }
  return notes;
};

export class AdminController {
  constructor(private readonly deps: AdminControllerDeps) {}

  listPatients = async (req: AuthenticatedRequest, res: Response) => {
    const query = patientListQuerySchema.parse(req.query ?? {});
    res.status(200).json(await this.deps.admin.listPatients(query));
  };

  /**
   * One patient's record: the account, who they are, the baseline, and
   * the histories §B4 names — 报告 / 随访 / 跌倒 / 量表.
   *
   * WHAT IT DOES NOT SEND, and why that is not an oversight. Measurements,
   * function tests, symptom scores, daily impacts, activity logs and
   * medications are read (they arrive inside `getProfileByUserId`) and
   * then dropped. §B4 enumerates the histories above, no admin
   * screen renders the rest, and every field of a patient's record that
   * crosses the wire without a reader is sensitive data spent for
   * nothing. Adding a section here is a decision, not a default.
   *
   * The sections are projected off `getProfileByUserId`, `listFalls` and
   * `listAdministrations` rather than off new SQL. `getProfileByUserId`
   * issues far more statements than the sections here read results
   * from, and the cost is paid on purpose: those queries carry the
   * `deleted_at IS NULL` filters that keep a record the patient
   * retracted from coming back to life, and a second query shape over
   * the same tables is a second place to forget one. This endpoint
   * serves a handful of operators, not patients.
   *
   * `baseline` is THE STORED COLUMN, not the read-time merge, and
   * `baselineIsStored` says so on the wire — see AdminStoredProfile for
   * what goes wrong if an edit form is filled from the merged payload.
   */
  getPatientRecord = async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = adminUserIdParamsSchema.parse(req.params);

    const account = await this.deps.admin.getAccount(userId);
    if (!account) {
      throw new AppError('Patient account not found', 404);
    }

    const stored = await this.deps.admin.getStoredProfile(userId);
    if (!stored) {
      // The account exists and has never opened the baseline form.
      // Answered as a record with no profile rather than as a 404: a
      // 404 here reads as「查无此人」and sends the operator looking for
      // an account that is right in front of them.
      //
      // `baseline: null` IS the answer to「what is in the column」 for
      // this account, and `baselineIsStored` stays true because that
      // field means「what you were sent is the column, not the
      // read-time merge」 — which is exactly what null is here. It does
      // NOT mean the record can be saved: `updatePatientBaseline`
      // answers 409 for this account, because a `patient_profiles` row
      // is the patient's own onboarding to write. A client that opens
      // an edit form must therefore check `baseline !== null` as well;
      // see the note in updatePatientBaseline.
      res.status(200).json({
        account,
        identity: null,
        baseline: null,
        baselineIsStored: true,
        fieldOrigins: [],
        documents: [],
        followups: [],
        falls: [],
        instruments: [],
      });
      return;
    }

    const [profile, falls, instruments] = await Promise.all([
      this.deps.profiles.getProfileByUserId(userId),
      this.deps.falls.listFalls(userId),
      this.deps.instruments.listAdministrations(userId, {}),
    ]);

    res.status(200).json({
      account,
      identity: {
        fullName: stored.fullName,
        preferredName: stored.preferredName,
        patientCode: stored.patientCode,
        regionLabel: stored.regionLabel,
        updatedAt: stored.updatedAt,
      },
      baseline: stored.baselinePayload,
      // Always true from this build. It is not a constant dressed up as
      // a field: it is the wire-level assertion「the baseline above is
      // the column, safe to edit and PUT back」, and a client that
      // enables its edit form without checking it will silently persist
      // the autofill merge the first time it talks to a build that
      // sends the merged payload instead.
      baselineIsStored: true,
      fieldOrigins: listBaselineFieldOrigins(stored.baselinePayload),
      documents: (profile?.documents ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        documentType: document.documentType,
        status: document.status,
        uploadedAt: document.uploadedAt,
      })),
      followups: (profile?.followupEvents ?? []).map((event) => ({
        id: event.id,
        eventType: event.eventType,
        severity: event.severity,
        occurredAt: event.occurredAt,
        description: event.description,
      })),
      falls: falls.falls.map((fall) => ({
        id: fall.id,
        occurredOn: fall.occurredOn,
        injured: fall.injured,
      })),
      instruments: instruments.map((administration) => ({
        id: administration.id,
        instrumentNameZh: administration.instrumentNameZh,
        scoredValue: administration.scoredValue,
        levelLabelZh: administration.levelLabelZh,
        administeredAt: administration.administeredAt,
      })),
    });
  };

  /**
   * The administrator's baseline write, and the one place in this
   * module where getting it wrong is worse than failing.
   *
   * EVERY NUMBERED ITEM BELOW HOLDS THE §B3 PROPERTY UP. Dropping one
   * is not a simplification — it is the property going away:
   *
   * 0. The write is REFUSED, 400, if it changes any field outside
   *    `ADMIN_WRITABLE_BASELINE_FIELDS`: the patient's answers about
   *    their own body — the ladder, the 现状 booleans, the 困难 scores
   *    — and the genetic results, which are laboratory measurements
   *    and not something a back office can be the source of.
   *    `baselineProfileSchema` accepts the whole baseline (it has to:
   *    the client sends the column back whole), so a body reaching
   *    this endpoint says nothing about where it came from and every
   *    field in it would otherwise be stamped 管理员代填. The refusal
   *    lives in `applyAdminBaselineWrite`; the test that this ENDPOINT
   *    answers 400 for one is in admin.controller.test.ts.
   *
   * 1. The body goes through `baselineProfileSchema`, a plain Zod
   *    object, so a caller that posts its own `fieldProvenance` block
   *    has it STRIPPED. An administrator cannot mark a field as
   *    patient-entered, and cannot attribute their own edit to another
   *    administrator, because the only writer of that block is
   *    `applyAdminBaselineWrite` below.
   *
   * 2. The stored payload is read FIRST and the helper is applied on
   *    the way in. `upsertBaseline` writes the payload over the whole
   *    `baseline_payload` column, so a write that skipped this would
   *    not merely fail to mark the new value — it would erase every
   *    marker already in the profile, silently, including ones from
   *    other administrators.
   *
   * 3. `previous` is the STORED column, read through
   *    `getStoredProfile`, and NOT `getBaselineByUserId(...).baseline`.
   *    The latter has `applyGeneticReportAutofill` applied, so diffing
   *    against it would let the administrator's save persist a D4Z4
   *    repeat count that lives only in the patient's genetic report
   *    into the baseline column — where it survives the report being
   *    corrected or deleted, attributed to the patient because nothing
   *    changed it. The record endpoint hands the same stored column to
   *    the edit form, so what the administrator was shown and what is
   *    diffed here are the same bytes. See AdminStoredProfile.
   *
   * PUT REPLACES THE WHOLE BASELINE, exactly like `PUT /profiles/me/
   * baseline` does for the patient. A client that sends only the
   * section it edited clears the rest. That semantic is not copied here
   * for symmetry's sake: a second, merging semantic on the same column
   * would mean「patient cleared a field」and「admin cleared a field」
   * take different paths through the provenance diff, and only one of
   * them would be tested.
   *
   * 4. AND BECAUSE IT REPLACES THE WHOLE BASELINE, THE BODY HAS TO BE
   *    BUILT ON THE VERSION THIS REQUEST IS DIFFED AGAINST. `If-Match`
   *    carries `identity.updatedAt` from the record read that filled
   *    the form, and a mismatch is refused below. Without it the diff
   *    is fresh-stored against a page-load-old body: a field the
   *    PATIENT changed while the form sat open reads as changed by the
   *    administrator, so their newer answer is written back to the
   *    older value AND stamped 管理员代填 under an administrator who
   *    never opened that box. That is not a race between two requests
   *    — the window is however long the page stayed open.
   */
  updatePatientBaseline = async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = adminUserIdParamsSchema.parse(req.params);
    const payload = baselineProfileSchema.parse(req.body);

    const account = await this.deps.admin.getAccount(userId);
    if (!account) {
      throw new AppError('Patient account not found', 404);
    }

    // A BODY THAT SURVIVED PARSING AS NOTHING IS NOT AN INSTRUCTION TO
    // ERASE. `baselineProfileSchema` is a plain Zod object AT EVERY
    // LEVEL: a key it does not know is dropped silently, so a client
    // one version out of step arrives here with no fields left. This
    // counts LEAVES, not sections — a body naming a section the schema
    // knows and filling it with field names it does not parses to
    // {foundation: {}}, which is a section with no answers in it. `upsertBaseline` REPLACES the column, and
    // `applyAdminBaselineWrite` reads an absent value as a deletion —
    // which the allowlist permits, because deleting an admin-writable
    // field is a write to an admin-writable field.
    //
    // Found by running it: a PUT of {「lifestyle」: {…}} against a
    // baseline holding only 确诊年份 returned 200 and left
    // `baseline_payload` as {}, taking the provenance block with it.
    // The allowlist catches this whenever any non-writable field is
    // present to be refused, so it survived every test that used a
    // realistic baseline.
    //
    // Sending no fields is therefore refused rather than obeyed.
    if (leafPaths(payload).length === 0) {
      throw new AppError(
        '这次提交里没有一个后台能识别的字段，所以没有改动任何东西。如果你确实想清空某一项，把那一项留空提交；如果你以为自己填了内容，多半是这一页和后台版本对不上，刷新一次再试。',
        400,
      );
    }

    const stored = await this.deps.admin.getStoredProfile(userId);
    if (!stored) {
      // THE ACCOUNT EXISTS AND HAS NO PROFILE ROW. Answered here, and
      // in these words, because the alternative was
      // `ensureProfileForUser`'s bare 404 「Patient profile not found」,
      // which the back office renders as 「这个账号可能已经注销，或者链接
      // 里的 ID 不对」 — neither of which is true, and the opposite of
      // the 「这个账号注册后没有建过档案」 the same screen prints from the
      // record endpoint's `identity: null`.
      //
      // 409 rather than 404 so the client cannot fold it into the
      // 「查无此人」 case, and Chinese because THE SENTENCE IS THE WHOLE
      // ANSWER: `describeAdminError`'s 409 branch (apps/mobile/screens/
      // p-admin/common.tsx) prints the server's message and adds
      // nothing to it. The 409s this router throws have different
      // remedies — some want a reload, some a different tool, some
      // nothing an operator can do — so each has to say, by itself,
      // what to do next.
      //
      // The back office does NOT create the row. A `patient_profiles`
      // row is what the patient's own onboarding writes (`createProfile`
      // in profile.service.ts); creating one from here would mean an
      // administrator completing a patient's onboarding for them, which
      // changes what that patient's app shows them and is a decision
      // nobody has made.
      throw new AppError(
        '这个账号注册后还没有建过健康档案，后台不能替他建。请让患者本人在 App 里先保存一次基线，或者确认这个用户 ID 是不是拿错了。',
        409,
      );
    }

    // THE FORM MUST HAVE BEEN BUILT ON WHAT IS STORED NOW. `If-Match`
    // is `identity.updatedAt` from the record read that filled it. The
    // token rides in the header rather than the body because
    // `baselineProfileSchema` is a plain Zod object and would strip an
    // extra key silently — the same stripping this endpoint relies on
    // for `fieldProvenance`.
    //
    // Absent and mismatched are both refused, and they are refused with
    // DIFFERENT sentences. They used to share one, which said the record
    // had been edited — true of a mismatch, and not something an absent
    // header shows at all. The operator would go looking for an edit
    // that never happened.
    //
    // A header sent with an empty or blank value is ABSENT, not a
    // mismatch. 「If-Match:」 with nothing after it reaches `req.header`
    // as '', which is not `undefined` and is not `stored.updatedAt`
    // either — so a bare `=== undefined` check sent the empty case down
    // the mismatch branch and told the operator somebody had edited the
    // record. Trimming also means a value padded with the whitespace
    // HTTP allows around a field value is compared as the token it is.
    const expectedUpdatedAt = req.header('if-match')?.trim();
    if (!expectedUpdatedAt) {
      throw new AppError(
        '这一页没有带上它打开时的档案版本，所以后台没法确认你看到的还是不是现在存的。请刷新这一页再试；如果刷新之后还是这样，是这一版后台的问题，别绕过去直接改。',
        409,
      );
    }
    if (expectedUpdatedAt !== stored.updatedAt) {
      // Says the version moved, not which fields moved: `updated_at` is
      // bumped by writers that touch no baseline field at all.
      throw new AppError(
        '现在存的这份档案，已经不是你打开这一页时的那一版了。请刷新这一页，看清现在存的是什么，再决定要不要改。',
        409,
      );
    }

    // Throws 400, naming the fields, when the write would change
    // anything outside ADMIN_WRITABLE_BASELINE_FIELDS. That refusal is
    // §10（四）of the privacy policy — 「你对自己身体的那些回答……后台只能
    // 看，不能替你填」 — enforced HERE rather than by which text boxes
    // the back office happens to draw. Nothing has been written yet
    // when it fires.
    const merged = applyAdminBaselineWrite(stored.baselinePayload, payload, {
      adminUserId: req.user.id,
    });

    // The cast is the point of the call, not a way around the types.
    // `BaselineProfileInput` is what `baselineProfileSchema` produces
    // and it has no `fieldProvenance` member — the schema strips it —
    // while `upsertBaseline` writes its argument into the jsonb column
    // verbatim. So the extra key has to survive the parameter, and the
    // only way to say that is to widen here, next to the comment
    // explaining it.
    //
    // `upsertBaseline` still raises its own 404「Patient profile not
    // found」through `ensureProfileForUser`, and that path is now only
    // reachable if the profile row disappears between the SELECT above
    // and this UPDATE — an account deleted mid-edit. The ordinary
    // 「never onboarded」 case is answered above, in words that are true
    // of it.
    await this.deps.profiles.upsertBaseline(userId, merged as unknown as BaselineProfileInput);

    // `merged` IS the column now — `upsertBaseline` writes its argument
    // verbatim — so this response is the stored payload rather than the
    // read-time merge its return value would have carried. Same
    // `baselineIsStored` contract as the record endpoint, so a client
    // may fill its form from either without knowing which it called.
    res.status(200).json({
      baseline: merged,
      baselineIsStored: true,
      fieldOrigins: listBaselineFieldOrigins(merged),
    });
  };

  /**
   * One patient, as a portable document.
   *
   * `includeLocalOnly` is NOT exposed, and the omission is the
   * decision. On the patient's own `/me/data-export` that flag is
   * opt-in because the local-only block carries their account of their
   * RELATIVES' health — a second data subject who consented to nothing
   * here — and it is theirs to disclose. An administrator ticking that
   * box on a patient's behalf is a different act by a different person,
   * so the admin route always sends `false`.
   *
   * AND IT WILL NOT HAND OUT A DOCUMENT THAT HAS DROPPED THE PROFILE'S
   * MARKERS. §B3 requires the 管理员代填 origin to leave WITH the data —
   * 「不能只在 App 里区分而导出里抹平」 — because a document that omits it
   * goes to a research registry or a hospital as the patient's own
   * account of themselves, and TREAT-NMD says so over the whole
   * document in as many words (「本导出中的绝大多数内容为患者自述或自评
   * ……每个条目的 provenanceZh 写明了来源」).
   *
   * Every builder in `PORTABLE_EXPORT_FORMATS` carried it on 2026-08-14.
   * Measured by calling `buildPortableExport` for each format on
   * `export/__fixtures__/profile.fixture.ts`'s profile with ONE
   * `fieldProvenance` entry added to its baseline, once per
   * `ADMIN_WRITABLE_BASELINE_FIELDS` path, and searching the serialised
   * document for `admin_entered`: present in every combination
   * (treat-nmd 11,501 bytes, phenopacket 6,325, fhir-r4 19,228 for the
   * `diseaseBackground.onsetRegion` case).
   *
   * A MARKER ON A PATH THE ALLOWLIST DOES NOT ADMIT SURVIVES THE SAME
   * WAY. Nothing on this path consults the allowlist, and that is
   * right: the allowlist governs what may be written, while a stored
   * marker is a fact about a value that is in the column now. Dropping
   * one would hand the document to a registry with a transcription in
   * it and nothing saying so. Same measurement on 2026-08-14 with the
   * entry keyed on `diseaseBackground.d4z4`: all three documents carry
   * `admin_entered` (treat-nmd 11,624 bytes, phenopacket 6,322, fhir-r4
   * 19,225).
   *
   * AN `unreadable` ENTRY IS CHECKED AGAINST A DIFFERENT WORD, because
   * the document says a different thing about it. Re-measuring the same
   * way on 2026-08-14 with the entry made unparseable (`{ source:
   * 'admin_entered' }`, no `adminUserId`): no document contains
   * `admin_entered` — nothing was admin-entered — and every one of them
   * carries `"state":"unreadable"` on the envelope plus 「此项的来源
   * 记录读不出来（…），只能确定不是患者本人填写」 beside the value
   * (treat-nmd 11,468 bytes, phenopacket 6,292, fhir-r4 19,195).
   * Checking the states together would refuse a document that IS honest
   * about the field, in a sentence calling it 管理员代填 — which is the
   * one rendering baseline-provenance.ts says an `unreadable` entry must
   * never be given.
   *
   * So the check is a REGRESSION GUARD on the bytes this endpoint
   * sends, not a list of formats to keep up to date: a builder that
   * stops emitting the origin — or a new format that never did —
   * refuses here rather than shipping the flattened document.
   */
  exportPatient = async (req: AuthenticatedRequest, res: Response) => {
    const { userId } = adminUserIdParamsSchema.parse(req.params);
    const { format } = patientExportQuerySchema.parse(req.query ?? {});

    const profile = await this.deps.profiles.getProfileByUserId(userId);
    if (!profile) {
      throw new AppError('Patient profile not found', 404);
    }

    // The STORED column, for the same reason the write path reads it:
    // `profile.baseline` has been through `applyGeneticReportAutofill`,
    // and whether that merge preserves the provenance block is not a
    // property this endpoint should have to depend on.
    const stored = await this.deps.admin.getStoredProfile(userId);
    const origins = listBaselineFieldOrigins(stored?.baselinePayload ?? null);
    // THE STATES ARE CHECKED SEPARATELY, because the document says a
    // different thing about each and a single check over them was wrong
    // about each: it refused a document that carried the `unreadable`
    // origin (which never contains the word `admin_entered`, because
    // nothing was admin-entered) and told the operator those fields
    // were 管理员代填 — the one rendering baseline-provenance.ts says an
    // `unreadable` entry must not be given.
    const adminEntered = origins.filter((entry) => entry.origin.state === 'admin_entered');
    const unreadable = origins.filter((entry) => entry.origin.state === 'unreadable');

    const at = new Date();
    const document = JSON.stringify(
      buildPortableExport(format, profile, {
        includeLocalOnly: false,
        generatedAt: at.toISOString(),
      }),
    );

    const pathsOf = (entries: typeof origins) => entries.map((entry) => entry.path).join('、');

    if (adminEntered.length > 0 && !document.includes(ADMIN_ENTERED_STATE)) {
      throw new AppError(
        `这份档案里有 ${adminEntered.length} 个字段是管理员代填的（${pathsOf(
          adminEntered,
        )}），但这次生成的 ${format} 文档里没有出现来源标记，发出去会被当成患者自述。已拒绝导出，请把这个情况报给维护者。` +
          '这些字段的来源可以在后台的患者档案页上逐条看到。',
        409,
      );
    }

    if (unreadable.length > 0 && !document.includes(UNREADABLE_STATE)) {
      throw new AppError(
        `这份档案里有 ${unreadable.length} 个字段的来源记录读不出来（${pathsOf(
          unreadable,
        )}），只能确定不是患者本人填写；但这次生成的 ${format} 文档里没有写明这一点，发出去会被当成患者自述。已拒绝导出，请把这个情况报给维护者。` +
          '这些字段的来源可以在后台的患者档案页上逐条看到。',
        409,
      );
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="openrd-${format}-${userId}-${at
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z')}-by-${req.user.id}.json"`,
    );
    // The bytes that were checked are the bytes that are sent.
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(document);
  };

  /**
   * THE MOST DANGEROUS ACTION IN THE PRODUCT: every patient's record,
   * in one file, on somebody's laptop.
   *
   * The order of the steps below is the whole design, so it is written
   * down rather than left to be inferred:
   *
   *   1. count the rows, and build the confirmation phrase from that
   *      count — so the operator is confirming the size of the file
   *      they will actually receive;
   *   2. no phrase, or a stale one → 428 carrying the phrase, the
   *      count, and what the file does and does not contain. Nothing
   *      has been read yet;
   *   3. a cohort larger than FULL_EXPORT_MAX_ROWS → refuse with the
   *      number. NEVER a truncated file: a CSV has nowhere to carry
   *      「这不是全部」and one that is short by 4,000 patients looks
   *      exactly like one that is not;
   *   4. read the rows, then check the count still matches. Somebody
   *      registering between step 1 and step 4 means the operator
   *      confirmed for a different file than the one in hand, so they
   *      re-confirm;
   *   5. write the second audit row — the one that records the row
   *      count and the filename — BEFORE a byte is serialised, and
   *      refuse the whole request if it cannot be written. An export
   *      with no trail of who took it is the one outcome this endpoint
   *      must not have;
   *   6. only then build and send.
   *
   * The response is built as one string and sent, rather than streamed
   * row by row. At FULL_EXPORT_MAX_ROWS the document is bounded (see
   * that constant), and a stream would introduce a `res.write`
   * backpressure loop whose failure mode — a truncated file that ends
   * mid-row — is the same failure step 3 exists to prevent, arriving by
   * a different door.
   */
  exportAllPatientsCsv = async (req: AuthenticatedRequest, res: Response) => {
    const body = fullExportBodySchema.parse(req.body ?? {});
    const patientCount = await this.deps.admin.countExportableProfiles();
    const at = new Date();
    const requiredConfirmation = buildFullExportConfirmation(patientCount, at);

    if (body.confirm !== requiredConfirmation) {
      // 428 Precondition Required, written here rather than thrown as
      // an AppError: the shared error handler filters `details` down to
      // CLIENT_SAFE_DETAIL_KEYS, so a thrown error would arrive at the
      // operator without the phrase they are being asked to send back.
      res.status(428).json({
        error: '全量导出需要二次确认',
        requiredConfirmation,
        patientCount,
        notes: [
          // DERIVED FROM `FULL_EXPORT_COLUMNS`, never written out by
          // hand. See buildFullExportDisclosureNotes for what the
          // hand-written sentence used to leave out and why a short
          // enumeration is worse than none.
          ...buildFullExportDisclosureNotes(),
          '请只在确实需要的时候导出。',
          // NOT 「从上传的基因报告自动补全」. `applyGeneticReportAutofill`
          // fills from the one document `pickGeneticEvidenceDocument`
          // picks as a profile's genetic evidence, and that picker takes
          // a 病历摘要 quoting the results when the genetics report read
          // out nothing — so this note asserted a genetics report behind
          // values that a summary supplied. The 全量导出 screen renders
          // these notes verbatim, on purpose, so the claim was on an
          // operator's screen without any client having written it.
          // What the file is missing is the same either way.
          '基线字段是数据库中存储的值，不含「从上传的文件自动补全」的部分——界面上看得到的 D4Z4 结果，这份文件里可能是空的。',
          // Points at the derived list above rather than naming a
          // second, hand-written set of columns beside it. The claim it
          // makes is a NEGATIVE one — these records are NOT in the file
          // — and the columns it is about are the 「……条数」 entries the
          // operator has just read.
          '上面那些「……条数」就只是条数：每一次肌力测量、每一份报告本身不在这份文件里。',
          '导出会以你的账号写入审计记录，文件名里也会带上你的账号与时间。',
        ],
      });
      return;
    }

    if (patientCount > FULL_EXPORT_MAX_ROWS) {
      throw new AppError(
        `本次导出涉及 ${patientCount} 位患者，超过单次上限 ${FULL_EXPORT_MAX_ROWS}。这个接口不会输出截断的文件，请改用 npm run db:backup。`,
        409,
      );
    }

    const rows = await this.deps.admin.listExportRows(FULL_EXPORT_MAX_ROWS);
    if (rows.length !== patientCount) {
      throw new AppError(
        `患者数量在你确认之后发生了变化（确认时 ${patientCount} 位，现在 ${rows.length} 位），请重新确认。`,
        409,
      );
    }

    const fileName = buildFullExportFileName(at, req.user.id);
    try {
      await this.deps.admin.recordFullExportAudit({
        adminUserId: req.user.id,
        // The same projection require-admin.ts applies to its own
        // row, imported rather than re-derived: audit rows describing
        // one request that disagree about the path are worse than any
        // of them alone.
        path: _auditPathOf(req.originalUrl),
        method: req.method,
        patientCount: rows.length,
        fileName,
      });
    } catch (error) {
      this.deps.logger.error(
        { err: error, adminUserId: req.user.id, patientCount: rows.length, fileName },
        'Refusing the full patient export because its audit row could not be written',
      );
      throw new AppError('全量导出暂不可用：审计记录写入失败', 503);
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.status(200).send(buildFullExportCsv(rows));
  };

  getCorpusStatus = async (_req: AuthenticatedRequest, res: Response) => {
    res.status(200).json(await this.deps.admin.getCorpusStatus());
  };

  getParseFailures = async (req: AuthenticatedRequest, res: Response) => {
    const { limit } = parseFailureQuerySchema.parse(req.query ?? {});
    res.status(200).json(
      await this.deps.admin.getParseFailureQueue({
        limit,
        stuckAfterMinutes: this.deps.ocrStuckAfterMinutes,
      }),
    );
  };

  getAiUsage = async (req: AuthenticatedRequest, res: Response) => {
    const { windowDays } = aiUsageQuerySchema.parse(req.query ?? {});
    res.status(200).json(await this.deps.admin.getAiUsage(windowDays));
  };

  /**
   * The same summary /healthz computes, with one field removed.
   *
   * An authenticated administrator gets the component detail that
   * /healthz withholds from an anonymous caller — the pg error string,
   * the KB URL, the parser path — because that is the whole reason to
   * have an operations screen, and the caller has passed the role check
   * and left an audit row.
   *
   * `components.kbService.state` is dropped even so. It is not our
   * string: it is the KB service's own status blob, and its `lastError`
   * is `str(exc)` from whatever `FSHDKnowledgeBase()` raised
   * (`_set_kb_state('error', error=str(exc), …)` in the warmup, around
   * knowledge_service.py:129) — an exception string from a constructor
   * that opens the database. That service says out loud, at its /multi
   * handler, that an exception string of its own may hold 「DB
   * credentials, internal file paths」 and refuses to put one on the
   * wire; this blob is the same class of string arriving by the other
   * door. Everything else here is generated by our own code from our
   * own errors and names infrastructure rather than credentials.
   */
  getOpsHealth = async (_req: AuthenticatedRequest, res: Response) => {
    const summary = await this.deps.healthSummary();
    const kbService = summary.components.kbService;
    const components =
      kbService && typeof kbService === 'object' && !Array.isArray(kbService)
        ? {
            ...summary.components,
            kbService: Object.fromEntries(
              Object.entries(kbService as Record<string, unknown>).filter(
                ([key]) => key !== 'state',
              ),
            ),
          }
        : summary.components;

    res.status(200).json({ ...summary, components });
  };
}

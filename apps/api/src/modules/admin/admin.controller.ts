import type { Response } from 'express';

import { buildFullExportCsv, buildFullExportFileName } from './admin.csv.js';
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
 * The two tokens an export has to carry for a marked profile to leave
 * this endpoint, one per origin STATE.
 *
 * Typed as `ExportFieldOrigin['state']` rather than written out as bare
 * strings, so a renamed state cannot leave the guard looking for a word
 * nothing writes any more. It is the EXPORT's vocabulary and not
 * `BASELINE_FIELD_SOURCES`, because what is searched for is what the
 * document says, and the two lists are different: the source is the
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
 * the controls that make it visible afterwards are the two audit rows
 * and the operator's id in the filename.
 */
export const buildFullExportConfirmation = (patientCount: number, at: Date): string =>
  `确认导出全部 ${patientCount} 位患者的完整数据 ${shanghaiDate(at)}`;

export class AdminController {
  constructor(private readonly deps: AdminControllerDeps) {}

  listPatients = async (req: AuthenticatedRequest, res: Response) => {
    const query = patientListQuerySchema.parse(req.query ?? {});
    res.status(200).json(await this.deps.admin.listPatients(query));
  };

  /**
   * One patient's record: the account, who they are, the baseline, and
   * the four histories §B4 names — 报告 / 随访 / 跌倒 / 量表.
   *
   * WHAT IT DOES NOT SEND, and why that is not an oversight. Measurements,
   * function tests, symptom scores, daily impacts, activity logs and
   * medications are read (they arrive inside `getProfileByUserId`) and
   * then dropped. §B4 enumerates the four histories above, no admin
   * screen renders the rest, and every field of a patient's record that
   * crosses the wire without a reader is sensitive data spent for
   * nothing. Adding a section here is a decision, not a default.
   *
   * The sections are projected off `getProfileByUserId`, `listFalls` and
   * `listAdministrations` rather than off new SQL. `getProfileByUserId`
   * alone is nine statements (the profile SELECT plus eight parallel
   * ones) and two of its results are used, and the cost is paid on
   * purpose: those queries carry the `deleted_at IS NULL` filters that
   * keep a record the patient retracted from coming back to life, and a
   * second query shape over the same tables is a second place to forget
   * one. This endpoint serves a handful of operators, not patients.
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
   * FOUR THINGS HOLD THE §B3 PROPERTY UP, and all four are here:
   *
   * 0. The write is REFUSED, 400, if it changes any field outside
   *    `ADMIN_WRITABLE_BASELINE_FIELDS` — the ladder, the 现状
   *    booleans, the 困难 scores. `baselineProfileSchema` accepts the
   *    whole baseline (it has to: the client sends the column back
   *    whole), so before that refusal existed this endpoint would
   *    happily stamp 管理员代填 on a patient's answer about their own
   *    body, and the only thing withholding it was which text boxes
   *    the back office drew. The refusal lives in
   *    `applyAdminBaselineWrite`; the test that this ENDPOINT answers
   *    400 for one is in admin.controller.test.ts.
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
   * The three builders carry it as of 2026-08-13. Measured by calling
   * `buildPortableExport` for each format on
   * `export/__fixtures__/profile.fixture.ts`'s profile with ONE
   * `fieldProvenance` entry added to its baseline, once per each of the
   * twelve ADMIN_WRITABLE_BASELINE_FIELDS paths, and searching the
   * serialised document for `admin_entered`: present in all 36
   * combinations (treat-nmd 7,629 bytes, phenopacket 4,470, fhir-r4
   * 15,540 for the `diseaseBackground.d4z4` case). Before that landed,
   * this endpoint refused every marked profile — the refusal was
   * written first and did not have to be taken out afterwards, which is
   * the point of checking it this way.
   *
   * AN `unreadable` ENTRY IS CHECKED AGAINST A DIFFERENT WORD, because
   * the document says a different thing about it. Re-measuring the same
   * way on 2026-08-13 with the d4z4 entry made unparseable (`{ source:
   * 'admin_entered' }`, no `adminUserId`): none of the three documents
   * contains `admin_entered` — nothing was admin-entered — and all
   * three carry `"state":"unreadable"` on the envelope plus 「此项的来源
   * 记录读不出来（…），只能确定不是患者本人填写」 beside the value
   * (treat-nmd 7,591 bytes, phenopacket 4,437, fhir-r4 15,507). One
   * check for both states therefore refused a document that WAS honest
   * about the field, in a sentence calling it 管理员代填 — which is the
   * one rendering baseline-provenance.ts says an `unreadable` entry must
   * never be given.
   *
   * So the check is a REGRESSION GUARD on the bytes this endpoint
   * sends, not a list of formats to keep up to date: a builder that
   * stops emitting the origin — or a fourth format that never did —
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
    // TWO STATES, CHECKED SEPARATELY, because the document says two
    // different things about them and one check for both was wrong
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
          '这份文件包含全部患者的姓名、手机号、所在地区与全部基线临床字段，请只在需要时导出。',
          '基线字段是数据库中存储的值，不含「从最近一份基因报告自动补全」的部分——界面上看得到的 D4Z4 结果，这份文件里可能是空的。',
          '每份记录的明细（每一次肌力测量、每一份报告）不在这份文件里，只有条数。',
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
        // row, imported rather than re-derived: two rows describing
        // one request that disagree about the path are worse than
        // either one alone.
        path: _auditPathOf(req.originalUrl),
        method: req.method,
        patientCount: rows.length,
        fileName,
      });
    } catch (error) {
      this.deps.logger.error(
        { error, adminUserId: req.user.id, patientCount: rows.length, fileName },
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

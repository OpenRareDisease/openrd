import type { Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildPortableExportMock = vi.fn<
  (
    format: string,
    profile: unknown,
    options: { includeLocalOnly: boolean },
  ) => { resourceType: string }
>(() => ({ resourceType: 'Bundle' }));
vi.mock('../patient-profile/export/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../patient-profile/export/index.js')>();
  return { ...actual, buildPortableExport: buildPortableExportMock };
});

const { AdminController, buildFullExportConfirmation } = await import('./admin.controller.js');
const { FULL_EXPORT_MAX_ROWS } = await import('./admin.service.js');
const { BASELINE_PROVENANCE_KEY } = await import('../patient-profile/baseline-provenance.js');

const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
const PATIENT_ID = '99999999-8888-7777-6666-555555555555';
/** `patient_profiles.updated_at` as the stored-profile stubs report it,
 *  and therefore what a form built on them sends back in `If-Match`. */
const STORED_UPDATED_AT = '2026-08-13T00:00:00.000Z';

const logger = {
  fatal: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  child: () => logger,
};

/** Captures what the handler wrote, so the assertions can be about the
 *  response rather than about mocks having been called. */
const fakeResponse = () => {
  const captured = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    status(code: number) {
      captured.statusCode = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
    send(body: unknown) {
      captured.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      captured.headers[name] = value;
    },
  } as unknown as Response;
  return { res, captured };
};

const request = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: ADMIN_ID, role: 'admin', token: 't' },
    params: {},
    query: {},
    body: {},
    method: 'GET',
    originalUrl: '/api/admin/patients',
    // The baseline PUT reads `If-Match`. The default is the version the
    // stored-profile stubs report, i.e. a form that was filled from the
    // record as it is now; a test about the stale-form refusal passes
    // its own `header`.
    header: (name: string) => (name.toLowerCase() === 'if-match' ? STORED_UPDATED_AT : undefined),
    ...overrides,
  }) as never;

const makeController = (overrides: {
  admin?: Record<string, unknown>;
  profiles?: Record<string, unknown>;
  falls?: Record<string, unknown>;
  instruments?: Record<string, unknown>;
  healthSummary?: () => Promise<unknown>;
}) =>
  new AdminController({
    admin: {
      getAccount: vi.fn(async () => ({
        userId: PATIENT_ID,
        phoneNumber: '+8613900000001',
        email: null,
        role: 'patient',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
      getStoredProfile: vi.fn(async () => null),
      listPatients: vi.fn(),
      countExportableProfiles: vi.fn(async () => 0),
      listExportRows: vi.fn(async () => []),
      recordFullExportAudit: vi.fn(async () => undefined),
      getCorpusStatus: vi.fn(),
      getParseFailureQueue: vi.fn(async () => ({ items: [], atCap: false })),
      getAiUsage: vi.fn(),
      ...overrides.admin,
    },
    profiles: {
      getProfileByUserId: vi.fn(async () => null),
      getBaselineByUserId: vi.fn(async () => null),
      upsertBaseline: vi.fn(async () => ({
        profileId: 'profile-1',
        fullName: null,
        preferredName: null,
        baseline: {},
        updatedAt: '2026-08-13T00:00:00.000Z',
      })),
      ...overrides.profiles,
    },
    falls: { listFalls: vi.fn(async () => ({ falls: [], summary: {}, windowDays: 180 })) },
    instruments: { listAdministrations: vi.fn(async () => []) },
    healthSummary:
      overrides.healthSummary ?? (async () => ({ status: 'ok', ready: true, components: {} })),
    ocrStuckAfterMinutes: 10,
    logger,
  } as never);

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * §B3, the property this whole module is built around: an
 * administrator's value must never be able to present itself as the
 * patient's own.
 */
describe('AdminController.updatePatientBaseline', () => {
  const storedProfile = (baselinePayload: Record<string, unknown> | null) => ({
    getStoredProfile: vi.fn(async () => ({
      profileId: 'profile-1',
      fullName: null,
      preferredName: null,
      patientCode: null,
      regionLabel: null,
      updatedAt: '2026-08-13T00:00:00.000Z',
      baselinePayload,
    })),
  });

  const profileWriter = () => ({
    upsertBaseline: vi.fn(async (_userId: string, payload: Record<string, unknown>) => ({
      profileId: 'profile-1',
      fullName: null,
      preferredName: null,
      baseline: payload,
      updatedAt: '2026-08-13T00:00:00.000Z',
    })),
  });

  const writtenPayload = (profiles: { upsertBaseline: ReturnType<typeof vi.fn> }) =>
    profiles.upsertBaseline.mock.calls[0][1] as Record<string, unknown>;

  const block = (payload: Record<string, unknown>) =>
    (payload[BASELINE_PROVENANCE_KEY] ?? {}) as Record<string, { source: string }>;

  it('marks the fields the administrator actually changed', async () => {
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { regionLabel: '浙江杭州' } }),
      profiles,
    });
    const { res, captured } = fakeResponse();

    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: { foundation: { regionLabel: '江苏南京' } },
        method: 'PUT',
      }),
      res,
    );

    expect(captured.statusCode).toBe(200);
    const entry = block(writtenPayload(profiles))['foundation.regionLabel'];
    expect(entry).toMatchObject({ source: 'admin_entered', adminUserId: ADMIN_ID });
  });

  it('leaves a field the administrator did not change attributed to the patient', async () => {
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { regionLabel: '浙江杭州', preferredName: '小张' } }),
      profiles,
    });
    const { res } = fakeResponse();

    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: { foundation: { regionLabel: '浙江杭州', preferredName: '张三' } },
        method: 'PUT',
      }),
      res,
    );

    const written = block(writtenPayload(profiles));
    expect(written['foundation.preferredName']?.source).toBe('admin_entered');
    // ABSENCE IS THE PATIENT. A marker here would say an administrator
    // typed a value the patient typed.
    expect(written['foundation.regionLabel']).toBeUndefined();
  });

  it('carries an existing marker forward when the write touches a different field', async () => {
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({
        foundation: { regionLabel: '浙江杭州', preferredName: '小张' },
        [BASELINE_PROVENANCE_KEY]: {
          'foundation.regionLabel': {
            source: 'admin_entered',
            adminUserId: ADMIN_ID,
            at: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      profiles,
    });
    const { res } = fakeResponse();

    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: { foundation: { regionLabel: '浙江杭州', preferredName: '张三' } },
        method: 'PUT',
      }),
      res,
    );

    // `baselineProfileSchema` strips the block and `upsertBaseline`
    // writes over the whole column, so a write that skipped
    // applyAdminBaselineWrite would erase this marker — including
    // another administrator's.
    expect(block(writtenPayload(profiles))['foundation.regionLabel']).toMatchObject({
      at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('refuses a forged provenance block in the request body', async () => {
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { regionLabel: '浙江杭州' } }),
      profiles,
    });
    const { res } = fakeResponse();

    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: {
          foundation: { regionLabel: '江苏南京' },
          // An administrator trying to attribute their own edit to
          // somebody else, or to nobody.
          [BASELINE_PROVENANCE_KEY]: {
            'foundation.regionLabel': {
              source: 'admin_entered',
              adminUserId: '00000000-0000-0000-0000-000000000000',
              at: '1999-01-01T00:00:00.000Z',
            },
          },
        },
        method: 'PUT',
      }),
      res,
    );

    const entry = block(writtenPayload(profiles))['foundation.regionLabel'];
    expect(entry).toMatchObject({ adminUserId: ADMIN_ID });
    expect(entry).not.toMatchObject({ at: '1999-01-01T00:00:00.000Z' });
  });

  it('refuses to write a self-report answer, and says which ones', async () => {
    // §10（四）of the privacy policy: 「你对自己身体的那些回答——诊断
    // 进展、能不能独立行走、各项困难评分——后台只能看，不能替你填。」
    // Until this refusal existed the endpoint parsed the WHOLE
    // baseline schema and stamped every one of them `admin_entered`;
    // the only thing withholding them was which text boxes the back
    // office happened to draw.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ currentStatus: { footDrop: false } }),
      profiles,
    });
    const { res } = fakeResponse();

    const refused = await controller
      .updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: {
            currentStatus: { footDrop: true },
            currentChallenges: { pain: 3 },
            diseaseBackground: { diagnosisLadder: 'clinical_only' },
          },
          method: 'PUT',
        }),
        res,
      )
      .then(
        () => new Error('the write was accepted'),
        (caught: unknown) => caught as Error,
      );
    expect(refused).toMatchObject({ statusCode: 400 });

    // The sentence is the whole refusal — the throw carries no
    // machine-readable field list — so it has to name the fields the
    // way the operator's own screen does. A dotted English path inside
    // a Chinese sentence names nothing they can see.
    expect(refused.message).toContain('足下垂');
    expect(refused.message).toContain('疼痛');
    expect(refused.message).toContain('诊断进展');
    expect(refused.message).not.toMatch(/[a-zA-Z]+\.[a-zA-Z]+/);

    // Nothing was written at all — not the refused fields, and not the
    // rest of the payload either.
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  it('refuses to write a genetic result, and names it the way the screen does', async () => {
    // The case this endpoint exists to make impossible: a laboratory
    // result dictated over a phone call, landing in the column as a
    // number indistinguishable from one a laboratory produced. A
    // clinical recommendation downstream reads the number, not the
    // marker.
    //
    // The payload here is also what an ordinary save looks like when
    // the form was filled from an autofilled read: the whole baseline
    // goes back, so the genetic value the merge supplied is in the body
    // even though the operator only touched 备注. The refusal has to
    // name the field for them to have any idea what happened.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { fullName: '张三' } }),
      profiles,
    });
    const { res } = fakeResponse();

    const refused = await controller
      .updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: {
            foundation: { fullName: '张三' },
            diseaseBackground: {
              diagnosisType: 'FSHD1',
              d4z4: '4/22',
              haplotype: '4qA',
              methylation: '12%',
            },
            notes: '电话里说的',
          },
          method: 'PUT',
        }),
        res,
      )
      .then(
        () => new Error('the write was accepted'),
        (caught: unknown) => caught as Error,
      );

    expect(refused).toMatchObject({ statusCode: 400 });
    expect(refused.message).toContain('FSHD 分型');
    expect(refused.message).toContain('D4Z4 重复数');
    expect(refused.message).toContain('单倍型');
    expect(refused.message).toContain('甲基化');
    expect(refused.message).not.toMatch(/[a-zA-Z]+\.[a-zA-Z]+/);
    // 备注 was a legitimate edit in the same body and it does not land
    // either — a refused write writes nothing.
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  it('keeps a stored marker on a field the allowlist does not admit', async () => {
    // Profiles carry such markers, and the value they describe is still
    // in the column. The §B3 list this endpoint answers with is what the
    // back office renders its 管理员代填 chips from, so dropping the
    // entry would turn an administrator's transcription into an unmarked
    // value on the screen whose whole job is to mark it.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({
        foundation: { fullName: '张三' },
        diseaseBackground: { d4z4: '4/22' },
        [BASELINE_PROVENANCE_KEY]: {
          'diseaseBackground.d4z4': {
            source: 'admin_entered',
            adminUserId: ADMIN_ID,
            at: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      profiles,
    });
    const { res, captured } = fakeResponse();

    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: {
          foundation: { fullName: '张三丰' },
          // Echoed back unchanged, which is not a write to it.
          diseaseBackground: { d4z4: '4/22' },
        },
        method: 'PUT',
      }),
      res,
    );

    expect(captured.statusCode).toBe(200);
    expect(block(writtenPayload(profiles))['diseaseBackground.d4z4']).toMatchObject({
      adminUserId: ADMIN_ID,
      at: '2026-01-01T00:00:00.000Z',
    });
    expect(captured.body).toMatchObject({
      fieldOrigins: expect.arrayContaining([
        expect.objectContaining({
          path: 'diseaseBackground.d4z4',
          origin: expect.objectContaining({ state: 'admin_entered' }),
        }),
      ]),
    });
  });

  it('still accepts the fields an administrator does transcribe', async () => {
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({
        foundation: { fullName: '张三' },
        currentStatus: { footDrop: false },
      }),
      profiles,
    });
    const { res, captured } = fakeResponse();

    // The back office sends the WHOLE baseline back, self-report
    // answers included, because `upsertBaseline` overwrites the column.
    // Echoing them unchanged must not read as an attempt to write them.
    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: {
          foundation: { fullName: '张三丰' },
          currentStatus: { footDrop: false },
        },
        method: 'PUT',
      }),
      res,
    );

    expect(captured.statusCode).toBe(200);
    expect(block(writtenPayload(profiles))['foundation.fullName']).toMatchObject({
      source: 'admin_entered',
    });
  });

  it('says the account has no profile instead of saying it may be deleted', async () => {
    // The account exists and has never opened the baseline form. The
    // record endpoint answers 200 for it, so the back office can open
    // this account; the save then reached `upsertBaseline` and came
    // back as a bare 404, which the operator's screen renders as
    // 「这个账号可能已经注销，或者链接里的 ID 不对」 — both false, and the
    // opposite of what the same screen says two blocks higher up.
    const profiles = profileWriter();
    const controller = makeController({
      admin: { getStoredProfile: vi.fn(async () => null) },
      profiles,
    });
    const { res } = fakeResponse();

    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { foundation: { fullName: '张三' } },
          method: 'PUT',
        }),
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('没有建过健康档案'),
    });
    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { foundation: { fullName: '张三' } },
          method: 'PUT',
        }),
        res,
      ),
    ).rejects.toMatchObject({ message: expect.not.stringContaining('注销') });
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  it('refuses a save built on a version of the record that has since changed', async () => {
    // The body is the whole baseline as the FORM loaded it, and the
    // diff is against the column as it is NOW. Without this refusal a
    // field the patient corrected while the page sat open reads as
    // changed by the administrator: their newer answer is written back
    // to the older value and stamped 管理员代填 under an administrator
    // who never opened that box.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ diseaseBackground: { onsetRegion: '肩带' } }),
      profiles,
    });
    const { res } = fakeResponse();

    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { diseaseBackground: { onsetRegion: '面部' } },
          method: 'PUT',
          header: (name: string) =>
            name.toLowerCase() === 'if-match' ? '2026-08-12T00:00:00.000Z' : undefined,
        }),
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('刷新'),
    });
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  it('refuses a body whose fields the schema does not know, rather than erasing', async () => {
    // Found by running the API, not by reading it. `baselineProfileSchema`
    // drops keys it does not know, so a client one version out of step
    // arrives with an empty payload; `upsertBaseline` REPLACES the
    // column and an absent value reads as a deletion. The allowlist
    // does not stop it when every field in the stored baseline is one
    // an administrator may write — deleting an admin-writable field is
    // a write to an admin-writable field.
    //
    // Live reproduction: PUT {lifestyle:{…}} over a baseline holding
    // only 确诊年份 answered 200 and left baseline_payload as {}, with
    // the provenance block gone.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { diagnosisYear: 2016 } }),
      profiles,
    });

    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { lifestyle: { smoking: 'never' } },
          method: 'PUT',
        }),
        fakeResponse().res,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('没有一个后台能识别的字段'),
    });
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  it('refuses a known section whose every field name the schema strips', async () => {
    // Same leak as the patient route: counting top-level keys let
    // {「foundation」:{「diagnosis_year」:2016}} through as {foundation:{}},
    // and the allowlist is no backstop — the implied deletion touches
    // only 确诊年份, which an administrator MAY write.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { diagnosisYear: 2016 } }),
      profiles,
    });

    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { foundation: { diagnosis_year: 2016 }, lifestyle: { smoking: 'never' } },
          method: 'PUT',
        }),
        fakeResponse().res,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  it('refuses a save that carries no version at all, and does not call it an edit', async () => {
    // Refused like a stale one — but NOT with the stale one's sentence.
    // 「已经不是你打开这一页时的那一版了」 asserts somebody changed the
    // record, which an absent header shows nothing about; an operator
    // reading it would go hunting for an edit that never happened.
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { fullName: '张三' } }),
      profiles,
    });
    const { res } = fakeResponse();

    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { foundation: { fullName: '张三丰' } },
          method: 'PUT',
          header: () => undefined,
        }),
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('没有带上'),
    });
    await expect(
      controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { foundation: { fullName: '张三丰' } },
          method: 'PUT',
          header: () => undefined,
        }),
        fakeResponse().res,
      ),
    ).rejects.not.toMatchObject({ message: expect.stringContaining('已经不是') });
    expect(profiles.upsertBaseline).not.toHaveBeenCalled();
  });

  /**
   * Runs the baseline write with `If-Match` set to `ifMatch` against a
   * record stored at STORED_UPDATED_AT, and hands back the error it
   * refused with. Fails if it did not refuse.
   */
  const refusalWithIfMatch = async (ifMatch: string | undefined) => {
    const profiles = profileWriter();
    const controller = makeController({
      admin: storedProfile({ foundation: { fullName: '张三' } }),
      profiles,
    });
    try {
      await controller.updatePatientBaseline(
        request({
          params: { userId: PATIENT_ID },
          body: { foundation: { fullName: '张三丰' } },
          method: 'PUT',
          header: (name: string) => (name.toLowerCase() === 'if-match' ? ifMatch : undefined),
        }),
        fakeResponse().res,
      );
    } catch (error) {
      expect(profiles.upsertBaseline).not.toHaveBeenCalled();
      return error as { statusCode: number; message: string };
    }
    throw new Error('expected the write to be refused');
  };

  /**
   * THE TWO REFUSALS HAVE TO BE TWO DIFFERENT SENTENCES, and this is
   * the assertion that they are.
   *
   * The two tests above each pin one phrase out of their own message,
   * which is not enough: 「请刷新这一页」 appears in both, so rewriting
   * the mismatch message into the absent-header text leaves both of
   * them green while the operator whose form went stale is told the
   * version was never sent. Comparing the two messages is what fails.
   */
  it('says two different things about a missing version and a stale one', async () => {
    const stale = await refusalWithIfMatch('2026-08-12T00:00:00.000Z');
    const absent = await refusalWithIfMatch(undefined);

    expect(stale.statusCode).toBe(409);
    expect(absent.statusCode).toBe(409);
    expect(stale.message).not.toBe(absent.message);
    // Each says the thing that is true of its own case, and neither
    // says the other's.
    expect(stale.message).toContain('已经不是你打开这一页时的那一版');
    expect(stale.message).not.toContain('没有带上');
    expect(absent.message).toContain('没有带上它打开时的档案版本');
    expect(absent.message).not.toContain('已经不是');
  });

  /**
   * 「If-Match:」 with nothing after it. `req.header` answers '' rather
   * than undefined, so the absent branch has to test the VALUE and not
   * just its presence — otherwise the empty header falls through to the
   * mismatch branch and asserts an edit that nobody made.
   */
  it('treats an If-Match with an empty value as no version at all', async () => {
    for (const empty of ['', '   ']) {
      const refusal = await refusalWithIfMatch(empty);
      expect(refusal.statusCode).toBe(409);
      expect(refusal.message).toContain('没有带上它打开时的档案版本');
      expect(refusal.message).not.toContain('已经不是');
    }
  });

  it('answers 404 for a user id that belongs to no account', async () => {
    const controller = makeController({
      admin: { getAccount: vi.fn(async () => null) },
      profiles: profileWriter(),
    });
    const { res } = fakeResponse();

    await expect(
      controller.updatePatientBaseline(
        request({ params: { userId: PATIENT_ID }, body: {}, method: 'PUT' }),
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

/**
 * THE READ AND THE WRITE MUST SEE THE SAME BYTES.
 *
 * The record endpoint fills the administrator's form and the write
 * endpoint diffs against what it read. If those two ever came from
 * different sources — the stored column on one side, the read-time
 * genetic-report merge on the other — an administrator who edited one
 * field would either persist inferred values nobody typed or stamp
 * 管理员代填 across values the OCR supplied. So both go through
 * `getStoredProfile`, and this is the assertion that they do.
 */
describe('the record read and the baseline write read the same column', () => {
  it('both call getStoredProfile, and neither calls getBaselineByUserId', async () => {
    const admin = {
      getStoredProfile: vi.fn(async () => ({
        profileId: 'profile-1',
        fullName: null,
        preferredName: null,
        patientCode: null,
        regionLabel: null,
        updatedAt: '2026-08-13T00:00:00.000Z',
        baselinePayload: { foundation: { regionLabel: '浙江杭州' } },
      })),
    };
    const getBaselineByUserId = vi.fn();
    const upsertBaseline = vi.fn(async (_userId: string, payload: Record<string, unknown>) => ({
      profileId: 'profile-1',
      fullName: null,
      preferredName: null,
      baseline: payload,
      updatedAt: '2026-08-13T00:00:00.000Z',
    }));
    const controller = makeController({
      admin,
      profiles: {
        getBaselineByUserId,
        upsertBaseline,
        getProfileByUserId: vi.fn(async () => ({ documents: [], followupEvents: [] })),
      },
    });

    const read = fakeResponse();
    await controller.getPatientRecord(request({ params: { userId: PATIENT_ID } }), read.res);
    const write = fakeResponse();
    await controller.updatePatientBaseline(
      request({
        params: { userId: PATIENT_ID },
        body: { foundation: { regionLabel: '浙江杭州' } },
        method: 'PUT',
      }),
      write.res,
    );

    expect(admin.getStoredProfile).toHaveBeenCalledTimes(2);
    // The autofilled read is what would put inferred values in front of
    // the administrator and then into the column.
    expect(getBaselineByUserId).not.toHaveBeenCalled();
    expect((read.res as never) && (read.captured.body as { baseline: unknown }).baseline).toEqual({
      foundation: { regionLabel: '浙江杭州' },
    });
    // Nothing changed, so nothing is marked.
    const written = upsertBaseline.mock.calls[0][1] as Record<string, unknown>;
    expect(written[BASELINE_PROVENANCE_KEY]).toBeUndefined();
    expect((write.captured.body as { baselineIsStored: boolean }).baselineIsStored).toBe(true);
  });
});

describe('AdminController.exportAllPatientsCsv', () => {
  const exportRow = () => ({
    userId: PATIENT_ID,
    phoneNumber: '+8613900000001',
    email: null,
    accountRole: 'patient',
    accountIsActive: true,
    accountCreatedAt: new Date('2026-01-02T03:04:05.000Z'),
    profileId: 'profile-1',
    patientCode: null,
    fullName: '张三',
    preferredName: null,
    dateOfBirth: null,
    gender: null,
    heightCm: null,
    weightKg: null,
    bloodType: null,
    contactPhone: null,
    contactEmail: null,
    primaryPhysician: null,
    regionProvince: null,
    regionCity: null,
    regionDistrict: null,
    diagnosisStage: null,
    diagnosisDate: null,
    geneticMutation: null,
    notes: null,
    baselinePayload: null,
    aiConsentPersonal: false,
    aiConsentThirdParty: false,
    aiConsentPreciseValues: false,
    clinicalTrialConsent: false,
    dataDonationConsent: false,
    hospitalSyncConsent: false,
    communityShareConsent: false,
    profileCreatedAt: new Date('2026-01-02T03:04:05.000Z'),
    profileUpdatedAt: new Date('2026-02-02T03:04:05.000Z'),
    counts: {
      measurements: 0,
      function_tests: 0,
      symptom_scores: 0,
      daily_impacts: 0,
      followup_events: 0,
      activity_logs: 0,
      documents: 0,
      medications: 0,
      falls: 0,
      instrument_administrations: 0,
    },
  });

  const exportRequest = (confirm?: string) =>
    request({
      method: 'POST',
      originalUrl: '/api/admin/exports/patients.csv?debug=1',
      body: confirm === undefined ? {} : { confirm },
    });

  it('refuses without the confirmation and hands back the phrase to send', async () => {
    const admin = {
      countExportableProfiles: vi.fn(async () => 36),
      listExportRows: vi.fn(async () => []),
      recordFullExportAudit: vi.fn(async () => undefined),
    };
    const controller = makeController({ admin });
    const { res, captured } = fakeResponse();

    await controller.exportAllPatientsCsv(exportRequest(), res);

    expect(captured.statusCode).toBe(428);
    const body = captured.body as {
      requiredConfirmation: string;
      patientCount: number;
      notes: string[];
    };
    expect(body.patientCount).toBe(36);
    expect(body.requiredConfirmation).toContain('36');
    // THE NOTES ARE RENDERED VERBATIM by the 全量导出 screen, which is
    // why what they name is settled here. The autofill reads whichever
    // document `pickGeneticEvidenceDocument` picks as a profile's
    // genetic evidence, and that picker takes a 病历摘要 quoting the
    // results — so a note naming 基因报告 put a claim about a document
    // nobody had seen onto an operator's screen, for every patient in
    // the file at once.
    expect(body.notes.join('')).toContain('不含「从上传的文件自动补全」的部分');
    expect(body.notes.join('')).not.toContain('基因报告');
    // Nothing was read and nothing was audited as an export: the
    // operator has not taken anything yet.
    expect(admin.listExportRows).not.toHaveBeenCalled();
    expect(admin.recordFullExportAudit).not.toHaveBeenCalled();
  });

  it('refuses a confirmation built for a different cohort size', async () => {
    const controller = makeController({
      admin: { countExportableProfiles: vi.fn(async () => 36) },
    });
    const { res, captured } = fakeResponse();

    await controller.exportAllPatientsCsv(
      exportRequest(buildFullExportConfirmation(35, new Date())),
      res,
    );

    expect(captured.statusCode).toBe(428);
  });

  it('produces the file, with the operator and timestamp on it, once confirmed', async () => {
    const admin = {
      countExportableProfiles: vi.fn(async () => 1),
      listExportRows: vi.fn(async () => [exportRow()]),
      recordFullExportAudit: vi.fn<(entry: Record<string, unknown>) => Promise<void>>(
        async () => undefined,
      ),
    };
    const controller = makeController({ admin });
    const { res, captured } = fakeResponse();

    await controller.exportAllPatientsCsv(
      exportRequest(buildFullExportConfirmation(1, new Date())),
      res,
    );

    expect(captured.statusCode).toBe(200);
    expect(captured.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(captured.headers['Content-Disposition']).toContain(`-by-${ADMIN_ID}.csv`);
    expect(String(captured.body)).toContain('user_id');
    expect(String(captured.body)).toContain('张三');

    const audit = admin.recordFullExportAudit.mock.calls[0][0];
    expect(audit).toMatchObject({ adminUserId: ADMIN_ID, patientCount: 1, method: 'POST' });
    // The query string is stripped, matching _auditPathOf: a future
    // filter parameter on this route would otherwise land in the trail.
    expect(audit.path).toBe('/api/admin/exports/patients.csv');
    expect(audit.fileName).toBe(
      captured.headers['Content-Disposition']
        .replace('attachment; filename="', '')
        .replace('"', ''),
    );
  });

  it('sends nothing when the audit row cannot be written', async () => {
    const admin = {
      countExportableProfiles: vi.fn(async () => 1),
      listExportRows: vi.fn(async () => [exportRow()]),
      recordFullExportAudit: vi.fn(async () => {
        throw new Error('audit insert failed');
      }),
    };
    const controller = makeController({ admin });
    const { res, captured } = fakeResponse();

    await expect(
      controller.exportAllPatientsCsv(
        exportRequest(buildFullExportConfirmation(1, new Date())),
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 503 });

    // An export with no trail of who took it is the one outcome this
    // endpoint must not have.
    expect(captured.body).toBeUndefined();
    expect(captured.headers['Content-Disposition']).toBeUndefined();
  });

  it('refuses rather than truncating when the cohort is over the cap', async () => {
    const admin = {
      countExportableProfiles: vi.fn(async () => FULL_EXPORT_MAX_ROWS + 1),
      listExportRows: vi.fn(async () => []),
      recordFullExportAudit: vi.fn(async () => undefined),
    };
    const controller = makeController({ admin });
    const { res } = fakeResponse();

    await expect(
      controller.exportAllPatientsCsv(
        exportRequest(buildFullExportConfirmation(FULL_EXPORT_MAX_ROWS + 1, new Date())),
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(admin.listExportRows).not.toHaveBeenCalled();
  });

  it('refuses when the cohort changed between the confirmation and the read', async () => {
    const admin = {
      countExportableProfiles: vi.fn(async () => 1),
      listExportRows: vi.fn(async () => [exportRow(), exportRow()]),
      recordFullExportAudit: vi.fn(async () => undefined),
    };
    const controller = makeController({ admin });
    const { res } = fakeResponse();

    await expect(
      controller.exportAllPatientsCsv(
        exportRequest(buildFullExportConfirmation(1, new Date())),
        res,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(admin.recordFullExportAudit).not.toHaveBeenCalled();
  });
});

describe('AdminController.exportPatient', () => {
  it('never asks for the local-only block, which holds a relative’s health', async () => {
    const controller = makeController({
      profiles: { getProfileByUserId: vi.fn(async () => ({ id: 'profile-1' })) },
    });
    const { res, captured } = fakeResponse();

    await controller.exportPatient(
      request({ params: { userId: PATIENT_ID }, query: { format: 'fhir-r4' } }),
      res,
    );

    expect(captured.statusCode).toBe(200);
    expect(buildPortableExportMock.mock.calls[0][2]).toMatchObject({ includeLocalOnly: false });
    expect(captured.headers['Content-Disposition']).toContain(`-by-${ADMIN_ID}.json`);
  });

  it('refuses to hand out a document that drops an administrator’s marker', async () => {
    // §B3: 「导出（FHIR / Phenopacket / TREAT-NMD）也带上这个来源，不能
    // 只在 App 里区分而导出里抹平。」 The mocked builder here returns a
    // document with no origin in it, which is what a builder that
    // regressed — or a fourth format that never carried one — looks
    // like from this endpoint. The real three carry it (measured; see
    // the note on `exportPatient`), and if one stops, the patient's
    // record must not go to a registry or a hospital with an
    // administrator's transcription presented as the patient's own
    // account of themselves.
    const controller = makeController({
      admin: {
        getStoredProfile: vi.fn(async () => ({
          profileId: 'profile-1',
          fullName: null,
          preferredName: null,
          patientCode: null,
          regionLabel: null,
          updatedAt: '2026-08-13T00:00:00.000Z',
          baselinePayload: {
            diseaseBackground: { d4z4: '4/22' },
            [BASELINE_PROVENANCE_KEY]: {
              'diseaseBackground.d4z4': {
                source: 'admin_entered',
                adminUserId: ADMIN_ID,
                at: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        })),
      },
      profiles: { getProfileByUserId: vi.fn(async () => ({ id: 'profile-1' })) },
    });
    const { res } = fakeResponse();

    await expect(
      controller.exportPatient(
        request({ params: { userId: PATIENT_ID }, query: { format: 'fhir-r4' } }),
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('diseaseBackground.d4z4'),
    });
  });

  it('hands the document over once it carries the marker', async () => {
    // The refusal is on the BYTES, so it retires itself: the day the
    // three builders write the origin into the document, this endpoint
    // starts exporting marked profiles again with no edit here.
    buildPortableExportMock.mockReturnValueOnce({
      resourceType: 'Bundle',
      provenance: [{ path: 'diseaseBackground.d4z4', source: 'admin_entered' }],
    } as never);
    const controller = makeController({
      admin: {
        getStoredProfile: vi.fn(async () => ({
          profileId: 'profile-1',
          fullName: null,
          preferredName: null,
          patientCode: null,
          regionLabel: null,
          updatedAt: '2026-08-13T00:00:00.000Z',
          baselinePayload: {
            diseaseBackground: { d4z4: '4/22' },
            [BASELINE_PROVENANCE_KEY]: {
              'diseaseBackground.d4z4': {
                source: 'admin_entered',
                adminUserId: ADMIN_ID,
                at: '2026-08-01T00:00:00.000Z',
              },
            },
          },
        })),
      },
      profiles: { getProfileByUserId: vi.fn(async () => ({ id: 'profile-1' })) },
    });
    const { res, captured } = fakeResponse();

    await controller.exportPatient(
      request({ params: { userId: PATIENT_ID }, query: { format: 'fhir-r4' } }),
      res,
    );

    expect(captured.statusCode).toBe(200);
    expect(String(captured.body)).toContain('admin_entered');
  });

  /** A profile whose only provenance entry cannot be parsed —
   *  `adminUserId` is missing, so `listBaselineFieldOrigins` answers
   *  `{ state: 'unreadable' }`. Only a hand-written UPDATE or a
   *  half-applied future shape produces one. */
  const unreadableMarkerProfile = () => ({
    getStoredProfile: vi.fn(async () => ({
      profileId: 'profile-1',
      fullName: null,
      preferredName: null,
      patientCode: null,
      regionLabel: null,
      updatedAt: '2026-08-13T00:00:00.000Z',
      baselinePayload: {
        diseaseBackground: { d4z4: '4/22' },
        [BASELINE_PROVENANCE_KEY]: {
          'diseaseBackground.d4z4': { source: 'admin_entered' },
        },
      },
    })),
  });

  it('exports an unreadable marker, because that is what the three formats carry for one', async () => {
    // The document the real builders produce for this profile: the
    // envelope's `fieldOrigins` carries `state: 'unreadable'`
    // (export-source.ts) and each serialiser appends 「此项的来源记录读不
    // 出来（…），只能确定不是患者本人填写」 beside the value. The origin is
    // in the bytes; the word `admin_entered` is not, because nothing
    // here was admin-entered — the entry is unparseable, which is a
    // different fact. Checking the whole refusal against that one word
    // refused this document and told the operator it had 1 个字段是管理员
    // 代填的, which is the claim baseline-provenance.ts says a reader
    // must not make about an `unreadable` entry.
    buildPortableExportMock.mockReturnValueOnce({
      format: 'FHIR R4',
      document: { resourceType: 'Bundle' },
      fieldOrigins: [
        {
          path: 'diseaseBackground.d4z4',
          labelZh: 'D4Z4 重复数',
          state: 'unreadable',
          adminUserId: null,
          at: null,
          detail: 'adminUserId is not a user id',
        },
      ],
    } as never);
    const controller = makeController({
      admin: unreadableMarkerProfile(),
      profiles: { getProfileByUserId: vi.fn(async () => ({ id: 'profile-1' })) },
    });
    const { res, captured } = fakeResponse();

    await controller.exportPatient(
      request({ params: { userId: PATIENT_ID }, query: { format: 'fhir-r4' } }),
      res,
    );

    expect(captured.statusCode).toBe(200);
    expect(String(captured.body)).toContain('unreadable');
  });

  it('refuses a document that dropped an unreadable marker, without calling it 代填', async () => {
    // Same shape as the `admin_entered` refusal above and a different
    // sentence, because the two states are different facts: one says an
    // administrator typed the value, the other says we cannot tell who
    // did — 「a reader that renders it as anything other than 来源不明 is
    // wrong」 (baseline-provenance.ts).
    const controller = makeController({
      admin: unreadableMarkerProfile(),
      profiles: { getProfileByUserId: vi.fn(async () => ({ id: 'profile-1' })) },
    });
    const { res } = fakeResponse();

    await expect(
      controller.exportPatient(
        request({ params: { userId: PATIENT_ID }, query: { format: 'fhir-r4' } }),
        res,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('读不出来'),
    });
    await expect(
      controller.exportPatient(
        request({ params: { userId: PATIENT_ID }, query: { format: 'fhir-r4' } }),
        res,
      ),
    ).rejects.toMatchObject({ message: expect.not.stringContaining('代填') });
  });

  it('rejects an unknown format instead of picking one', async () => {
    const controller = makeController({
      profiles: { getProfileByUserId: vi.fn(async () => ({ id: 'profile-1' })) },
    });
    const { res } = fakeResponse();

    await expect(
      controller.exportPatient(
        request({ params: { userId: PATIENT_ID }, query: { format: 'csv' } }),
        res,
      ),
    ).rejects.toBeTruthy();
  });
});

describe('AdminController.getPatientRecord', () => {
  it('answers 200 with a null identity for an account that never opened the form', async () => {
    const controller = makeController({});
    const { res, captured } = fakeResponse();

    await controller.getPatientRecord(request({ params: { userId: PATIENT_ID } }), res);

    const body = captured.body as Record<string, unknown>;
    expect(captured.statusCode).toBe(200);
    // 「查无此人」and「有账号，没填过」are different answers and an
    // operator does something different about each.
    expect(body.account).toBeTruthy();
    expect(body.identity).toBeNull();
    expect(body.baseline).toBeNull();
    // Empty sections, not absent ones: on this client a missing section
    // means「这台服务器不返回」, which is not what is being said.
    expect(body.documents).toEqual([]);
    expect(body.falls).toEqual([]);
  });

  it('sends the four §B4 histories and nothing else off the record', async () => {
    const controller = makeController({
      admin: {
        getStoredProfile: vi.fn(async () => ({
          profileId: 'profile-1',
          fullName: '张三',
          preferredName: null,
          patientCode: 'FSHD-0001',
          regionLabel: '杭州',
          updatedAt: '2026-08-13T00:00:00.000Z',
          baselinePayload: {
            foundation: { regionLabel: '浙江杭州' },
            [BASELINE_PROVENANCE_KEY]: {
              'foundation.regionLabel': {
                source: 'admin_entered',
                adminUserId: ADMIN_ID,
                at: '2026-01-01T00:00:00.000Z',
              },
            },
          },
        })),
      },
      profiles: {
        getProfileByUserId: vi.fn(async () => ({
          documents: [
            {
              id: 'doc-1',
              title: '基因报告',
              documentType: 'genetic_report',
              status: 'parsed',
              uploadedAt: '2026-03-02T00:00:00.000Z',
              // Read by getProfileByUserId, dropped here: the OCR text
              // of a report has no reader on the admin record screen.
              ocrPayload: { fields: { d4z4Repeats: '6' } },
              storageUri: 'local://uploads/doc-1',
            },
          ],
          followupEvents: [
            {
              id: 'event-1',
              eventType: 'fall',
              severity: 'mild',
              occurredAt: '2026-04-01T00:00:00.000Z',
              description: '在浴室滑倒',
            },
          ],
          measurements: [{ id: 'm-1' }],
          medications: [{ id: 'med-1' }],
        })),
      },
    });
    const { res, captured } = fakeResponse();

    await controller.getPatientRecord(request({ params: { userId: PATIENT_ID } }), res);
    const body = captured.body as Record<string, unknown>;

    expect(body.identity).toMatchObject({ fullName: '张三', patientCode: 'FSHD-0001' });
    expect(body.baselineIsStored).toBe(true);
    expect(body.fieldOrigins).toEqual([
      {
        path: 'foundation.regionLabel',
        origin: { state: 'admin_entered', adminUserId: ADMIN_ID, at: '2026-01-01T00:00:00.000Z' },
      },
    ]);
    expect(body.documents).toEqual([
      {
        id: 'doc-1',
        title: '基因报告',
        documentType: 'genetic_report',
        status: 'parsed',
        uploadedAt: '2026-03-02T00:00:00.000Z',
      },
    ]);
    expect(body.followups).toHaveLength(1);
    // Sections with no reader are not shipped. Every field of a
    // patient's record on the wire without one is spent for nothing.
    expect(Object.keys(body).sort()).toEqual([
      'account',
      'baseline',
      'baselineIsStored',
      'documents',
      'falls',
      'fieldOrigins',
      'followups',
      'identity',
      'instruments',
    ]);
    expect(JSON.stringify(body)).not.toContain('storageUri');
    expect(JSON.stringify(body)).not.toContain('ocrPayload');
  });
});

describe('AdminController.getOpsHealth', () => {
  it('drops the KB service’s own state blob and keeps our diagnostics', async () => {
    const controller = makeController({
      healthSummary: async () => ({
        status: 'degraded',
        ready: true,
        components: {
          database: { status: 'ok' },
          kbService: {
            status: 'error',
            url: 'http://kb-service:5010/health/ready',
            // knowledge_service.py documents this as potentially
            // carrying a connection string with a password.
            state: { lastError: 'postgresql://user:hunter2@db:5432/openrd refused' },
          },
        },
      }),
    });
    const { res, captured } = fakeResponse();

    await controller.getOpsHealth(request(), res);

    const body = captured.body as { components: Record<string, Record<string, unknown>> };
    expect(body.components.kbService.state).toBeUndefined();
    expect(body.components.kbService.status).toBe('error');
    // The operations screen exists to answer「为什么 degraded」, so our
    // own diagnostics stay.
    expect(body.components.kbService.url).toBe('http://kb-service:5010/health/ready');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('passes a summary with no kbService component through untouched', async () => {
    const controller = makeController({
      healthSummary: async () => ({
        status: 'ok',
        ready: true,
        components: { database: { status: 'ok' } },
      }),
    });
    const { res, captured } = fakeResponse();

    await controller.getOpsHealth(request(), res);
    expect(captured.body).toMatchObject({
      status: 'ok',
      components: { database: { status: 'ok' } },
    });
  });
});

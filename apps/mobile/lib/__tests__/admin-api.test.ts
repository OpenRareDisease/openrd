import {
  ADMIN_FIELD_ORIGIN_LABEL,
  AdminResponseError,
  asFieldOrigin,
  buildAdminBaselineWrite,
  exportAdminPatient,
  listAdminPatients,
  parseContentDispositionFilename,
  readAdminAiUsage,
  readAdminCorpusStatus,
  readAdminHealth,
  readAdminParseFailureQueue,
  readAdminPatientRecord,
  requestAdminFullPatientCsv,
  updateAdminPatientBaseline,
} from '../admin-api';

// lib/api reaches AsyncStorage and SecureStore through
// lib/session-storage; neither has a native module under jest.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
  multiRemove: () => Promise.resolve(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
  isAvailableAsync: () => Promise.resolve(false),
}));

// The real module for `ApiError`, `API_BASE_URL` and the error-message
// extraction — the download path below builds on all three, and a
// hand-made stub of ApiError would make `instanceof` checks pass for a
// class the app never throws.
jest.mock('../api', () => {
  const actual = jest.requireActual('../api');
  return {
    ...actual,
    apiRequest: jest.fn(),
    getAuthToken: jest.fn(async () => 'token-abc'),
  };
});

const { apiRequest, API_BASE_URL, ApiError } = require('../api') as {
  apiRequest: jest.Mock;
  API_BASE_URL: string;
  ApiError: new (message: string) => Error & { status?: number; data?: unknown };
};

/**
 * The properties this client exists to hold, each pinned by the failure
 * it prevents.
 *
 * The response bodies below are copied from the DTOs in
 * apps/api/src/modules/admin/admin.service.ts — `AdminCorpusStatus`,
 * `AdminParseFailureQueue`, `AdminAiUsage`, `AdminPatientListItem` —
 * rather than invented, because a reader tested against a hand-made
 * object proves only that the reader agrees with the test.
 */

beforeEach(() => {
  apiRequest.mockReset();
});

describe('a missing number is not zero', () => {
  it('keeps an absent corpus count as null instead of 0', () => {
    // A server that does not compute `unembeddedChunkCount` must not
    // make this page say 「没有 embedding 的分块：0 段」. That is the
    // sentence an operator reads INSTEAD of checking the corpus.
    const status = readAdminCorpusStatus({ chunkCount: 12842, embedModels: [] });
    expect(status.chunkCount).toBe(12842);
    expect(status.unembeddedChunkCount).toBeNull();
    expect(status.sourceFileCount).toBeNull();
  });

  it('keeps a null failure rate null — 0/0 is not 0%', () => {
    const usage = readAdminAiUsage({
      windowDays: 7,
      retentionDays: 180,
      totalCalls: 0,
      byStatus: [],
      failureRate: null,
    });
    expect(usage.failureRate).toBeNull();
  });

  it('does not recompute the failure rate from byStatus', () => {
    // The server excludes consent_denied from both halves. A client
    // that divided for itself would put a different number in front of
    // a different person.
    const usage = readAdminAiUsage({
      windowDays: 7,
      retentionDays: 180,
      totalCalls: 10,
      byStatus: [
        { status: 'success', calls: 6, avgLatencyMs: 900 },
        { status: 'error', calls: 2, avgLatencyMs: null },
        { status: 'consent_denied', calls: 2, avgLatencyMs: null },
      ],
      failureRate: 0.25,
    });
    expect(usage.failureRate).toBe(0.25);
  });
});

describe('a body this build cannot read is surfaced, not emptied', () => {
  it.each([
    ['语料状态', () => readAdminCorpusStatus(null)],
    ['解析失败队列', () => readAdminParseFailureQueue({ atCap: false })],
    ['AI 调用统计', () => readAdminAiUsage('nope')],
    ['健康检查', () => readAdminHealth([])],
    ['患者档案', () => readAdminPatientRecord({ account: {} })],
  ])('%s', (_label, read) => {
    expect(read).toThrow(AdminResponseError);
  });

  it('rejects a patient list with no items array rather than showing an empty roster', async () => {
    apiRequest.mockResolvedValue({ page: 1, pageSize: 20, total: 40 });
    await expect(listAdminPatients()).rejects.toBeInstanceOf(AdminResponseError);
  });
});

describe('provenance: an entry we cannot read is never the patient', () => {
  it('reads an admin_entered entry', () => {
    expect(
      asFieldOrigin({
        state: 'admin_entered',
        adminUserId: '11111111-1111-4111-8111-111111111111',
        at: '2026-08-13T04:11:07.912Z',
      }),
    ).toEqual({
      state: 'admin_entered',
      adminUserId: '11111111-1111-4111-8111-111111111111',
      at: '2026-08-13T04:11:07.912Z',
    });
  });

  it('downgrades an admin_entered entry missing its administrator', () => {
    // 「管理员代填」 with nobody behind it does not answer 「谁填的」, and
    // the answer to a question we cannot answer is not 「本人」.
    const origin = asFieldOrigin({ state: 'admin_entered', at: '2026-08-13T04:11:07.912Z' });
    expect(origin.state).toBe('unreadable');
  });

  it.each([
    ['a shape that is not an object', 'admin_entered'],
    ['an unknown source', { state: 'imported_from_registry' }],
    ['an entry claiming to be the patient', { state: 'patient' }],
  ])('reads %s as unreadable', (_label, raw) => {
    // The last case is the one that matters: the server only lists
    // entries that are PRESENT in the provenance block, and a present
    // entry is by construction not the patient's. So `state: 'patient'`
    // on the wire is a shape this build does not understand — and the
    // safe reading of a shape we do not understand is 「来源不明」, never
    // 「本人填写」.
    expect(asFieldOrigin(raw).state).toBe('unreadable');
  });

  it('never labels an unreadable entry as the patient', () => {
    expect(ADMIN_FIELD_ORIGIN_LABEL.unreadable).toBe('来源不明');
    expect(ADMIN_FIELD_ORIGIN_LABEL.unreadable).not.toBe(ADMIN_FIELD_ORIGIN_LABEL.patient);
  });

  it('keeps an origin entry whose path is missing instead of dropping it', () => {
    // Dropping it would leave whichever field it belonged to rendering
    //「本人填写」 — the one claim §B3 exists to prevent.
    const record = readAdminPatientRecord({
      account: { userId: 'u1', phoneNumber: '13900000000' },
      fieldOrigins: [{ origin: { state: 'admin_entered', adminUserId: 'a1', at: 'x' } }],
    });
    expect(record.fieldOrigins).toHaveLength(1);
    expect(record.fieldOrigins[0].origin.state).toBe('admin_entered');
  });
});

describe('「服务端没返回这一节」 and 「这个患者没有」 stay different', () => {
  const base = { account: { userId: 'u1' } };

  it('a section the server omitted is null', () => {
    const record = readAdminPatientRecord(base);
    expect(record.documents).toBeNull();
    expect(record.falls).toBeNull();
  });

  it('a section the server sent empty is an empty array', () => {
    const record = readAdminPatientRecord({ ...base, documents: [], falls: [] });
    expect(record.documents).toEqual([]);
    expect(record.falls).toEqual([]);
  });

  it('leaves a fall with no 是否受伤 answer as null, not 没受伤', () => {
    const record = readAdminPatientRecord({
      ...base,
      falls: [{ id: 'f1', occurredOn: '2026-08-01' }],
    });
    expect(record.falls?.[0].injured).toBeNull();
  });
});

describe('the edit form cannot open on a payload we cannot account for', () => {
  it('defaults baselineIsStored to false when the server does not say', () => {
    // The payload the patient app reads has been through
    // applyGeneticReportAutofill. Saving on top of that would persist
    // inferred values under an administrator's name.
    expect(readAdminPatientRecord({ account: { userId: 'u1' } }).baselineIsStored).toBe(false);
    expect(
      readAdminPatientRecord({ account: { userId: 'u1' }, baselineIsStored: 'yes' })
        .baselineIsStored,
    ).toBe(false);
    expect(
      readAdminPatientRecord({ account: { userId: 'u1' }, baselineIsStored: true })
        .baselineIsStored,
    ).toBe(true);
  });
});

describe('a baseline write carries the whole payload', () => {
  const stored = {
    foundation: { fullName: '张三', birthYear: 1988 },
    diseaseBackground: { d4z4: '4/22' },
    fieldProvenance: {
      'foundation.fullName': { source: 'admin_entered', adminUserId: 'a1', at: 'x' },
    },
  };

  it('keeps every untouched field, including the provenance block', () => {
    // `upsertBaseline` runs `SET baseline_payload = $1` over the whole
    // column, and `applyAdminBaselineWrite` derives the changed set by
    // diffing. A partial payload would delete the rest of the baseline
    // AND stamp 管理员代填 on the fields it dropped.
    const next = buildAdminBaselineWrite(stored, { 'diseaseBackground.d4z4': '3/22' });
    expect(next).toEqual({
      foundation: { fullName: '张三', birthYear: 1988 },
      diseaseBackground: { d4z4: '3/22' },
      fieldProvenance: {
        'foundation.fullName': { source: 'admin_entered', adminUserId: 'a1', at: 'x' },
      },
    });
  });

  it('does not mutate the payload it was handed', () => {
    buildAdminBaselineWrite(stored, { 'foundation.fullName': '李四' });
    expect(stored.foundation.fullName).toBe('张三');
  });

  it('writes a top-level field', () => {
    expect(buildAdminBaselineWrite(null, { notes: '电话里核对过' })).toEqual({
      notes: '电话里核对过',
    });
  });

  it('refuses a path it cannot write instead of dropping the edit', () => {
    // A silently ignored edit is an operator who believes they saved a
    // value that was never sent.
    expect(() => buildAdminBaselineWrite(stored, { 'a.b.c': 'x' })).toThrow('a.b.c');
  });
});

describe('the wire calls', () => {
  it('reads the real patient-list body', async () => {
    // Copied from AdminPatientListResult / AdminPatientListItem.
    apiRequest.mockResolvedValue({
      page: 2,
      pageSize: 20,
      total: 40,
      items: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          patientCode: 'FSHD-0001',
          maskedName: '张〇',
          maskedPhone: '139****0001',
          role: 'patient',
          isActive: true,
          hasProfile: true,
          registeredAt: '2026-07-01T02:00:00.000Z',
          profileUpdatedAt: '2026-08-01T02:00:00.000Z',
        },
        { patientCode: 'FSHD-0002' },
      ],
    });
    const result = await listAdminPatients({ page: 2, q: '张' });
    expect(apiRequest).toHaveBeenCalledWith('/admin/patients?page=2&pageSize=20&q=%E5%BC%A0');
    expect(result.page).toBe(2);
    expect(result.total).toBe(40);
    // The row with no userId is dropped: it cannot be opened, and an
    // unopenable row still reads as a patient we have.
    expect(result.items).toHaveLength(1);
    expect(result.items[0].maskedPhone).toBe('139****0001');
  });

  it('PUTs the baseline to the user-id-keyed path', async () => {
    apiRequest.mockResolvedValue({});
    await updateAdminPatientBaseline('11111111-1111-4111-8111-111111111111', { notes: 'x' });
    expect(apiRequest).toHaveBeenCalledWith(
      '/admin/patients/11111111-1111-4111-8111-111111111111/baseline',
      { method: 'PUT', body: JSON.stringify({ notes: 'x' }) },
    );
  });

  it('reads the real parse-failure queue body', () => {
    const queue = readAdminParseFailureQueue({
      items: [
        {
          documentId: '22222222-2222-4222-8222-222222222222',
          userId: '11111111-1111-4111-8111-111111111111',
          documentType: 'genetic_report',
          status: 'parse_failed',
          uploadedAt: '2026-08-10T02:00:00.000Z',
        },
      ],
      atCap: true,
      limit: 50,
      stuckAfterMinutes: 30,
    });
    expect(queue.items).toHaveLength(1);
    expect(queue.atCap).toBe(true);
    expect(queue.stuckAfterMinutes).toBe(30);
  });

  it('turns the health components map into rows without inventing a status', () => {
    const health = readAdminHealth({
      status: 'degraded',
      ready: true,
      components: {
        database: { status: 'ok' },
        kbService: { status: 'error', detail: 'connect ECONNREFUSED' },
        storage: {},
      },
    });
    expect(health.draining).toBe(false);
    expect(health.components).toEqual([
      { name: 'database', status: 'ok', detail: null },
      { name: 'kbService', status: 'error', detail: 'connect ECONNREFUSED' },
      { name: 'storage', status: '未知', detail: null },
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* 导出 — §B4                                                          */
/* ------------------------------------------------------------------ */

/**
 * A response shaped like the ones these two endpoints actually send.
 * `fetch` is stubbed rather than `Response` constructed, because the
 * jest environment this suite runs in has no whatwg Response and a
 * hand-built one would be a third shape nobody serves.
 */
const fakeResponse = ({
  ok = true,
  status = 200,
  headers = {},
  body = null,
  blob = { size: 7 },
}: {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  blob?: unknown;
} = {}) => ({
  ok,
  status,
  headers: {
    get: (name: string) => headers[name.toLowerCase()] ?? null,
  },
  json: async () => body,
  blob: async () => blob,
});

const mockFetch = () => {
  const fn = jest.fn();
  (globalThis as { fetch?: unknown }).fetch = fn;
  return fn;
};

describe('the server-issued filename is read, never invented', () => {
  it.each([
    [
      'attachment; filename="openrd-patients-20260813T041107Z-by-a1.csv"',
      'openrd-patients-20260813T041107Z-by-a1.csv',
    ],
    ["attachment; filename*=UTF-8''openrd-%E5%85%A8%E9%87%8F.csv", 'openrd-全量.csv'],
    ['attachment; filename=plain.json', 'plain.json'],
  ])('reads %s', (header, expected) => {
    expect(parseContentDispositionFilename(header)).toBe(expected);
  });

  it.each([
    [null],
    ['attachment'],
    // A name that would take the file somewhere the operator did not
    // choose. Refused rather than sanitised: the caller's fallback
    // says on screen that the server's name was not used.
    ['attachment; filename="../../etc/passwd"'],
  ])('refuses %s', (header) => {
    expect(parseContentDispositionFilename(header)).toBeNull();
  });
});

describe('one patient, as a document', () => {
  it('asks for the format the caller named, with the bearer token, and returns the server filename', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      fakeResponse({
        headers: {
          'content-disposition':
            'attachment; filename="openrd-treat-nmd-11111111-1111-4111-8111-111111111111-20260813T041107Z-by-a1.json"',
        },
      }),
    );

    const download = await exportAdminPatient('11111111-1111-4111-8111-111111111111', 'treat-nmd');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `${API_BASE_URL}/admin/patients/11111111-1111-4111-8111-111111111111/export?format=treat-nmd`,
    );
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
    expect(download.fileName).toBe(
      'openrd-treat-nmd-11111111-1111-4111-8111-111111111111-20260813T041107Z-by-a1.json',
    );
  });

  it('reports a header this browser would not show us as null rather than guessing one', async () => {
    // Cross-origin without Access-Control-Expose-Headers. A locally
    // invented name would carry neither the operator nor the server's
    // timestamp while looking exactly like one that does.
    mockFetch().mockResolvedValue(fakeResponse({ headers: {} }));
    const download = await exportAdminPatient('11111111-1111-4111-8111-111111111111', 'fhir-r4');
    expect(download.fileName).toBeNull();
  });

  it('does not retry a failed export', async () => {
    // apiRequest retries a transport-failed GET once. Here that would
    // be a second admin.export audit row against this patient for one
    // operator action.
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await expect(
      exportAdminPatient('11111111-1111-4111-8111-111111111111', 'fhir-r4'),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('the full export is a two-step, and the second 428 is not a failure', () => {
  it('asks with no phrase first and returns what the server wants typed back', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 428,
        headers: { 'content-type': 'application/json' },
        body: {
          error: '全量导出需要二次确认',
          requiredConfirmation: '确认导出全部 35 位患者的完整数据 2026-08-13',
          patientCount: 35,
          notes: [
            '这份文件包含全部患者的姓名、手机号、所在地区与全部基线临床字段，请只在需要时导出。',
          ],
        },
      }),
    );

    const result = await requestAdminFullPatientCsv();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_BASE_URL}/admin/exports/patients.csv`);
    expect(init.method).toBe('POST');
    // No `confirm` key at all on the first step — an empty string would
    // be a confirmation attempt the server compares and rejects.
    expect(JSON.parse(init.body as string)).toEqual({});
    expect(result).toEqual({
      state: 'confirmation_required',
      requiredConfirmation: '确认导出全部 35 位患者的完整数据 2026-08-13',
      patientCount: 35,
      notes: ['这份文件包含全部患者的姓名、手机号、所在地区与全部基线临床字段，请只在需要时导出。'],
    });
  });

  it('sends the phrase back verbatim and returns the file', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      fakeResponse({
        headers: {
          'content-disposition':
            'attachment; filename="openrd-patients-20260813T041107Z-by-a1.csv"',
        },
        blob: { size: 4096 },
      }),
    );

    const result = await requestAdminFullPatientCsv('确认导出全部 35 位患者的完整数据 2026-08-13');

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      confirm: '确认导出全部 35 位患者的完整数据 2026-08-13',
    });
    expect(result.state).toBe('downloaded');
    if (result.state !== 'downloaded') throw new Error('unreachable');
    expect(result.download.fileName).toBe('openrd-patients-20260813T041107Z-by-a1.csv');
  });

  it('a stale phrase comes back as another confirmation, not as an error', async () => {
    // The phrase carries the row count and today's date in Asia/
    // Shanghai. Both go stale. Throwing here would tell an operator who
    // typed it correctly that the export failed.
    mockFetch().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 428,
        headers: { 'content-type': 'application/json' },
        body: {
          requiredConfirmation: '确认导出全部 36 位患者的完整数据 2026-08-14',
          patientCount: 36,
          notes: [],
        },
      }),
    );
    const result = await requestAdminFullPatientCsv('确认导出全部 35 位患者的完整数据 2026-08-13');
    expect(result).toMatchObject({
      state: 'confirmation_required',
      requiredConfirmation: '确认导出全部 36 位患者的完整数据 2026-08-14',
    });
  });

  it('refuses a 428 that carries no phrase instead of showing an unanswerable box', async () => {
    mockFetch().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 428,
        headers: { 'content-type': 'application/json' },
        body: { error: '全量导出需要二次确认' },
      }),
    );
    await expect(requestAdminFullPatientCsv()).rejects.toBeInstanceOf(AdminResponseError);
  });

  it('lets a real failure through as an ApiError carrying the server sentence', async () => {
    mockFetch().mockResolvedValue(
      fakeResponse({
        ok: false,
        status: 409,
        headers: { 'content-type': 'application/json' },
        body: { error: '患者数量在你确认之后发生了变化（确认时 35 位，现在 36 位），请重新确认。' },
      }),
    );
    await expect(
      requestAdminFullPatientCsv('确认导出全部 35 位患者的完整数据 2026-08-13'),
    ).rejects.toMatchObject({
      status: 409,
      message: '患者数量在你确认之后发生了变化（确认时 35 位，现在 36 位），请重新确认。',
    });
  });
});

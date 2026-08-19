import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService, withholdUnsafeReadings } from './profile.service.js';
import type { AppLogger } from '../../config/logger.js';

/**
 * THE READ-PATH GUARD.
 *
 * Every fixture here is synthetic. The shapes are real — they are the
 * shapes seven archived documents in this deployment are in — but no
 * value, name or identifier from a patient appears in this file.
 *
 * The three archived shapes, named the way this suite talks about them:
 *
 *   COLLAPSED COLUMN — CK, CK-MB, 肌酐 and LDH all carrying the CK
 *   number, because one cell was read four times. Five archived
 *   documents.
 *
 *   ROW INDEX — `ldh` carrying a table row number while the same
 *   report's real LDH sits under the generic table reader's own key.
 *   One archived document.
 *
 *   NEITHER — a wrong reading with nothing on the row to contradict it.
 *   One archived document, and the reason the reparse endpoint exists:
 *   a read guard cannot invent evidence the payload does not hold.
 */
const payloadWith = (fields: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  provider: 'embedded',
  extractedText: '（synthetic）',
  fields: { documentType: 'blood_panel', analysisStatus: 'completed', ...fields },
  ...extra,
});

const fieldsOf = (payload: unknown) => (payload as { fields: Record<string, string> }).fields ?? {};

const unsafeOf = (payload: unknown) =>
  (payload as { unsafeReadings?: Array<{ analyte: string; reason: string; disposition: string }> })
    .unsafeReadings ?? [];

describe('withholdUnsafeReadings — a reading identical to another analyte on the same report', () => {
  it('withholds every analyte in a collapsed column, and says which they collided with', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '4', ck: '693', ckmb: '693', creatinine: '693', ldh: '693' }),
    );

    expect(fieldsOf(guarded).ck).toBeUndefined();
    expect(fieldsOf(guarded).ckmb).toBeUndefined();
    expect(fieldsOf(guarded).creatinine).toBeUndefined();
    expect(fieldsOf(guarded).ldh).toBeUndefined();
    expect(unsafeOf(guarded).map((item) => item.analyte)).toEqual([
      'ck',
      'ckmb',
      'creatinine',
      'ldh',
    ]);
    expect(unsafeOf(guarded).every((item) => item.reason === 'duplicate_reading')).toBe(true);
  });

  /**
   * NEITHER OF THE TWO, NOT THE ONE THAT LOOKS WRONG. The payload does
   * not record which cell was really read. A guard that kept the
   * plausible number and dropped the implausible one would be this
   * module deciding a clinical value on grounds it does not have.
   */
  it('withholds BOTH sides of a collision, never a chosen survivor', () => {
    const guarded = withholdUnsafeReadings(payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }));
    expect(fieldsOf(guarded).ck).toBeUndefined();
    expect(fieldsOf(guarded).ldh).toBeUndefined();
  });

  /**
   * `buildFields` writes `creatineKinase = ck` and `myoglobin = mb`
   * beside the parser's own keys, and the passport reads both. A guard
   * that deleted `ck` and left `creatineKinase` standing would have
   * withheld nothing at all.
   */
  it('deletes every spelling of a withheld cell, bridge aliases and table slugs included', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({
        fieldCount: '4',
        ck: '693',
        creatineKinase: '693',
        table_ck: '693',
        ldh: '693',
        table_ldh: '693',
      }),
    );

    expect(Object.keys(fieldsOf(guarded))).toEqual([
      'documentType',
      'analysisStatus',
      'fieldCount',
    ]);
  });

  /**
   * The alias pair is the SAME cell. Agreeing spellings are not two
   * analytes reading the same number, and treating them as a collision
   * would have blanked every correctly-parsed CK on the platform.
   */
  it('an analyte agreeing with its own alias is not a collision', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', ck: '693', creatineKinase: '693', ldh: '241' }),
    );
    expect(fieldsOf(guarded).ck).toBe('693');
    expect(fieldsOf(guarded).ldh).toBe('241');
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  it('reads the number through the unit the laboratory printed', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', ck: '693 U/L', ldh: '693 U/L' }),
    );
    expect(unsafeOf(guarded)).toHaveLength(2);
  });

  /**
   * THE SCOPE IS THE SAFETY. Outside a laboratory panel「two identical
   * numbers」has ordinary true answers, and a guard that did not stop at
   * the analyte list would delete a D4Z4 repeat count because a
   * haplotype started with the same digit.
   */
  it('leaves non-analyte fields alone however often their values repeat', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({
        fieldCount: '3',
        d4z4Repeats: '4',
        haplotype: '4qA',
        deltoidStrength: '4',
        quadricepsStrength: '4',
      }),
    );
    expect(fieldsOf(guarded).d4z4Repeats).toBe('4');
    expect(fieldsOf(guarded).deltoidStrength).toBe('4');
    expect(fieldsOf(guarded).quadricepsStrength).toBe('4');
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  it('a non-numeric reading is not a number either question can be asked of', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', glucose: '阴性', urea: '阴性' }),
    );
    expect(unsafeOf(guarded)).toHaveLength(0);
  });
});

describe('withholdUnsafeReadings — one analyte, two spellings, two numbers', () => {
  /**
   * The archived row-index document. `ldh` holds a table row number and
   * `table_ldh` holds what the laboratory printed, and the guard's
   * answer used to depend on which key `Object.entries` yielded first —
   * so on that document it picked the row index and passed it.
   */
  it('withholds an analyte whose own spellings disagree', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '9', ldh: '9', table_ldh: '241', ck: '693' }),
    );

    expect(fieldsOf(guarded).ldh).toBeUndefined();
    expect(fieldsOf(guarded).table_ldh).toBeUndefined();
    expect(fieldsOf(guarded).ck).toBe('693');
    expect(unsafeOf(guarded)).toEqual([
      expect.objectContaining({
        analyte: 'ldh',
        reason: 'contradictory_aliases',
        disposition: 'withheld',
      }),
    ]);
  });

  it('a contradicted analyte cannot be dragged into a collision by whichever value won', () => {
    // `potassium` disagrees with `tableK`; `ck` happens to equal one of
    // the two. `ck` is a sound reading and must survive.
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '3', potassium: '693', tableK: '4.1', ck: '693' }),
    );
    expect(fieldsOf(guarded).ck).toBe('693');
    expect(fieldsOf(guarded).potassium).toBeUndefined();
    expect(unsafeOf(guarded).map((item) => item.analyte)).toEqual(['potassium']);
  });
});

describe('withholdUnsafeReadings — outside the interval the report itself printed', () => {
  const withReferences = (fields: Record<string, string>, refs: Record<string, unknown>) =>
    payloadWith(fields, { analyteReferences: refs });

  /**
   * MARKED, NOT WITHHELD, and the difference is the whole judgement.
   * On this platform a CK outside its interval is usually the disease.
   * Withholding everything abnormal would blank precisely the readings
   * the passport exists to carry.
   */
  it('marks a reading above the printed ceiling and keeps printing it', () => {
    const guarded = withholdUnsafeReadings(
      withReferences({ fieldCount: '1', ck: '693' }, { ck: { low: 50, high: 310 } }),
    );

    expect(fieldsOf(guarded).ck).toBe('693');
    expect(unsafeOf(guarded)).toEqual([
      expect.objectContaining({
        analyte: 'ck',
        reason: 'outside_reference_interval',
        disposition: 'flagged',
      }),
    ]);
  });

  it('marks a reading below the printed floor — the shape a slipped column produces', () => {
    const guarded = withholdUnsafeReadings(
      withReferences({ fieldCount: '1', ldh: '9' }, { ldh: { low: 120, high: 250 } }),
    );
    expect(unsafeOf(guarded)).toEqual([
      expect.objectContaining({ analyte: 'ldh', reason: 'outside_reference_interval' }),
    ]);
  });

  it('says nothing about a reading inside the interval', () => {
    const guarded = withholdUnsafeReadings(
      withReferences({ fieldCount: '1', ldh: '200' }, { ldh: { low: 120, high: 250 } }),
    );
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  it('honours a one-sided limit, which is the whole of what a CK-MB row states', () => {
    const guarded = withholdUnsafeReadings(
      withReferences({ fieldCount: '1', ckmb: '40' }, { ckmb: { low: null, high: 25 } }),
    );
    expect(unsafeOf(guarded)).toEqual([
      expect.objectContaining({ analyte: 'ckmb', reason: 'outside_reference_interval' }),
    ]);
  });

  /**
   * 120 of the 131 archived payloads predate the change that started
   * recording the reference column at all. The guard must be silent
   * about them rather than inventing an interval to judge them by —
   * that silence is exactly why the reparse endpoint is the repair and
   * this is only the net.
   */
  it('is silent where the report archived no interval', () => {
    const guarded = withholdUnsafeReadings(payloadWith({ fieldCount: '1', ldh: '9' }));
    expect(fieldsOf(guarded).ldh).toBe('9');
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  it('reads the interval off aiExtraction when the whole payload is in hand', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '1', ldh: '9' },
        {
          aiExtraction: {
            latest_summary: { by_analyte: { ldh: { reference_low: 120, reference_high: 250 } } },
          },
        },
      ),
    );
    expect(unsafeOf(guarded)).toEqual([
      expect.objectContaining({ analyte: 'ldh', reason: 'outside_reference_interval' }),
    ]);
  });
});

describe('withholdUnsafeReadings — what it leaves behind', () => {
  /**
   * NOT INSIDE `fields`, AND THIS IS NOT COSMETIC. The report screen
   * decides whether to offer 重新识别 by asking whether any
   * non-bookkeeping key survives in `fields`. A review note filed among
   * the readings would answer 「yes, this report still has data」 — and
   * suppress the offer to repair the very row the guard just emptied.
   */
  it('files the review record at the top level, never among the readings', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }),
    ) as Record<string, unknown>;

    expect(guarded.unsafeReadings).toHaveLength(2);
    expect(typeof guarded.unsafeReadingsNotice).toBe('string');
    expect(Object.keys(fieldsOf(guarded))).not.toContain('unsafeReadings');
    expect(Object.keys(fieldsOf(guarded))).not.toContain('unsafeReadingsNotice');
  });

  it('drops the working reference column so a clean payload is unchanged', () => {
    const clean = payloadWith({ fieldCount: '1', ck: '200' }, { analyteReferences: null });
    const guarded = withholdUnsafeReadings(clean) as Record<string, unknown>;
    expect('analyteReferences' in guarded).toBe(false);
    expect(guarded.unsafeReadings).toBeUndefined();
  });

  it('returns a clean payload untouched, by identity', () => {
    const clean = payloadWith({ fieldCount: '2', ck: '200', ldh: '241' });
    expect(withholdUnsafeReadings(clean)).toBe(clean);
  });

  it('does not mutate what it was handed — the repair path reads the stored row', () => {
    const stored = payloadWith({ fieldCount: '2', ck: '693', ldh: '693' });
    withholdUnsafeReadings(stored);
    expect((stored.fields as Record<string, string>).ldh).toBe('693');
  });

  it('passes null and non-payloads straight through', () => {
    expect(withholdUnsafeReadings(null)).toBeNull();
    expect(withholdUnsafeReadings(undefined)).toBeUndefined();
    expect(withholdUnsafeReadings('not a payload')).toBe('not a payload');
  });
});

describe('PatientProfileService.getDocumentOcrForUser', () => {
  const logger = {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: () => logger,
  } as unknown as AppLogger;

  const serviceWithRow = (row: Record<string, unknown>) => {
    const query = vi.fn().mockResolvedValue({ rows: [row], rowCount: 1 });
    const pool = { query, connect: vi.fn() } as never;
    return new PatientProfileService({ pool, logger });
  };

  /**
   * GET …/documents/:id/ocr read the row raw, which made it the one
   * door into `fields` the projection's guard did not cover — the raw
   * payload view would have printed the withheld reading anyway.
   */
  it('guards the single-document read the same way the projection does', async () => {
    const service = serviceWithRow({
      id: 'doc-1',
      status: 'parsed',
      ocr_payload: payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }),
    });

    const result = await service.getDocumentOcrForUser('user-1', 'doc-1');

    expect(result.status).toBe('parsed');
    expect(fieldsOf(result.ocrPayload).ldh).toBeUndefined();
    expect(unsafeOf(result.ocrPayload)).toHaveLength(2);
  });

  it('carries a clean payload through unchanged', async () => {
    const payload = payloadWith({ fieldCount: '2', ck: '693', ldh: '241' });
    const service = serviceWithRow({ id: 'doc-1', status: 'parsed', ocr_payload: payload });

    const result = await service.getDocumentOcrForUser('user-1', 'doc-1');
    expect(fieldsOf(result.ocrPayload).ldh).toBe('241');
    expect(fieldsOf(result.ocrPayload).ck).toBe('693');
  });
});

import { describe, expect, it, vi } from 'vitest';

import { PatientProfileService, withholdUnsafeReadings } from './profile.service.js';
import type { UnsafeReading } from './profile.service.js';
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

const unsafeOf = (payload: unknown): UnsafeReading[] =>
  (payload as { unsafeReadings?: UnsafeReading[] }).unsafeReadings ?? [];

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

/**
 * THE OTHER HALF OF QUESTION 1, AND THE ONE THAT COST CORRECT DATA.
 *
 * 「Two analytes, one number」 was treated as a slipped column outright.
 * Measured against this deployment's archive that was wrong on four of
 * the nine documents it fired on — ALT with AST, CK-MB with myoglobin,
 * albumin with ALP, glucose with urea — 8 readings the laboratory
 * really printed, blanked on every surface by the guard that exists to
 * protect them.
 *
 * The fixtures below carry a `page`, because the report's own page is
 * what settles it: a laboratory that printed the figure on two rows
 * printed it twice.
 */
describe('withholdUnsafeReadings — a shared number the report itself printed twice', () => {
  const withPage = (fields: Record<string, string>, page: string) =>
    payloadWith(fields, { extractedText: page });

  it('keeps ALT and AST at the same figure — the everyday biochemistry result', () => {
    const guarded = withholdUnsafeReadings(
      withPage(
        { fieldCount: '2', alt: '32 U/L', ast: '32 U/L' },
        '丙氨酸氨基转移酶 ALT 32 U/L\n天门冬氨酸氨基转移酶 AST 32 U/L',
      ),
    );

    expect(fieldsOf(guarded).alt).toBe('32 U/L');
    expect(fieldsOf(guarded).ast).toBe('32 U/L');
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  it('withholds a pair the page prints only once — a cell read twice', () => {
    const guarded = withholdUnsafeReadings(
      withPage({ fieldCount: '2', ck: '693 U/L', ldh: '693 U/L' }, '肌酸激酶 CK 693 U/L'),
    );

    expect(fieldsOf(guarded).ck).toBeUndefined();
    expect(fieldsOf(guarded).ldh).toBeUndefined();
    expect(unsafeOf(guarded).map((item) => item.corroboration)).toEqual([
      'page_prints_it_once',
      'page_prints_it_once',
    ]);
  });

  /**
   * The page is the answer in BOTH directions, so it also has to be
   * read as a page and not as a substring haystack: 「693」 lives inside
   * 「1693」 and a substring search would find the figure twice on a
   * report that printed it once.
   */
  it('counts numeric tokens, not substrings', () => {
    const guarded = withholdUnsafeReadings(
      withPage({ fieldCount: '2', ck: '693', ldh: '693' }, 'CK 693 U/L  肌红蛋白 1693 ng/mL'),
    );
    expect(unsafeOf(guarded)).toHaveLength(2);
    expect(unsafeOf(guarded)[0].disposition).toBe('withheld');
  });

  it('reads 693.0 on the page as the figure the extractor filed as 693', () => {
    const guarded = withholdUnsafeReadings(
      withPage({ fieldCount: '2', alt: '32', ast: '32' }, 'ALT 32.0 U/L\nAST 32.00 U/L'),
    );
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  it('reads a thousands separator and full-width digits as the same figure', () => {
    const guarded = withholdUnsafeReadings(
      withPage({ fieldCount: '2', ck: '1693', mb: '1693' }, 'CK 1,693 U/L\nMB １６９３ ng/mL'),
    );
    expect(unsafeOf(guarded)).toHaveLength(0);
  });

  /**
   * No panel prints one figure on three different rows by chance, and
   * this is the archived shape: CK, CK-MB, 肌酐 and LDH all carrying
   * the CK number. It is withheld whatever the page says, because a
   * page that happened to print the figure four times would be four
   * copies of the same defect.
   */
  it('withholds a group of three or more whatever the page shows', () => {
    const guarded = withholdUnsafeReadings(
      withPage(
        { fieldCount: '3', ck: '693', ckmb: '693', ldh: '693' },
        'CK 693 CKMB 693 LDH 693 参考 693',
      ),
    );
    expect(unsafeOf(guarded)).toHaveLength(3);
    expect(unsafeOf(guarded).every((item) => item.corroboration === 'three_or_more_rows')).toBe(
      true,
    );
  });
});

describe('withholdUnsafeReadings — a shared number on a report with no legible page', () => {
  /**
   * 「I cannot tell」 is a true thing to say and a blank cell is not. A
   * pair with no page and nothing else to corroborate a slip is MARKED
   * and still printed — the coincidence is the likelier of the two
   * readings, and over-deleting a correct value is its own clinical
   * defect.
   */
  it('marks an uncorroborated pair rather than deleting it', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', alt: '32 U/L', ast: '32 U/L' }, { extractedText: '' }),
    );

    expect(fieldsOf(guarded).alt).toBe('32 U/L');
    expect(fieldsOf(guarded).ast).toBe('32 U/L');
    expect(unsafeOf(guarded)).toEqual([
      expect.objectContaining({
        analyte: 'alt',
        disposition: 'flagged',
        reason: 'duplicate_reading',
        sharedWith: ['ast'],
      }),
      expect.objectContaining({ analyte: 'ast', disposition: 'flagged', sharedWith: ['alt'] }),
    ]);
  });

  /** A page carrying no number at all answers nothing either. */
  it('treats a page with no figures on it as no page', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '2', alt: '32', ast: '32' },
        { extractedText: '检验报告单（图像质量不佳）' },
      ),
    );
    expect(unsafeOf(guarded).every((item) => item.disposition === 'flagged')).toBe(true);
  });

  /**
   * `ck` against `ldh` is this parser's own documented defect — five
   * archived documents of it — so the pair is corroboration in its own
   * right on a row whose page cannot be read.
   */
  it('withholds the known collision pair with no page to check it against', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }, { extractedText: '' }),
    );
    expect(fieldsOf(guarded).ck).toBeUndefined();
    expect(unsafeOf(guarded).every((item) => item.corroboration === 'known_pair')).toBe(true);
  });

  /**
   * Same number, same unit, same printed interval is one whole row read
   * twice. Two real rows would differ somewhere.
   */
  it('withholds a pair that also shares its unit and its printed interval', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '2', alt: '32 U/L', ast: '32 U/L' },
        {
          extractedText: '',
          analyteReferences: { alt: { low: 9, high: 50 }, ast: { low: 9, high: 50 } },
        },
      ),
    );
    expect(fieldsOf(guarded).alt).toBeUndefined();
    expect(unsafeOf(guarded).every((item) => item.corroboration === 'one_row_twice')).toBe(true);
  });

  it('two intervals that differ is two rows, and the pair is only marked', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '2', alt: '32 U/L', ast: '32 U/L' },
        {
          extractedText: '',
          analyteReferences: { alt: { low: 9, high: 50 }, ast: { low: 15, high: 40 } },
        },
      ),
    );
    expect(fieldsOf(guarded).alt).toBe('32 U/L');
    expect(unsafeOf(guarded).every((item) => item.disposition === 'flagged')).toBe(true);
  });

  /**
   * 120 of the archived payloads predate the reference column, so 「no
   * interval」 must not read as 「the same interval」 — that would put
   * the deletion straight back on every pair the guard just stopped
   * deleting.
   */
  it('does not read two missing intervals as one shared interval', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', alt: '32 U/L', ast: '32 U/L' }, { extractedText: '' }),
    );
    expect(fieldsOf(guarded).alt).toBe('32 U/L');
  });

  it('does not read two missing units as one shared unit', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '2', alt: '32', ast: '32' },
        {
          extractedText: '',
          analyteReferences: { alt: { low: 9, high: 50 }, ast: { low: 9, high: 50 } },
        },
      ),
    );
    expect(fieldsOf(guarded).alt).toBe('32');
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

/**
 * THE NOTICE IS THE ONE SENTENCE THIS PLATFORM GIVES A PATIENT ABOUT
 * WHETHER TO TRUST THEIR OWN REPORT, so it may not describe a
 * withholding that did not happen. One fixed string stood here and told
 * every reader that values 「已经不再显示」 — including the four archived
 * documents where nothing was withheld at all and the only finding was
 * a reading outside its printed interval, still on the screen.
 */
describe('withholdUnsafeReadings — the notice describes THIS payload', () => {
  const noticeOf = (payload: unknown) =>
    (payload as { unsafeReadingsNotice?: string }).unsafeReadingsNotice ?? '';

  it('does not claim a withholding on a payload where everything is merely flagged', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '1', ck: '693' },
        { analyteReferences: { ck: { low: 50, high: 310 } } },
      ),
    );

    expect(fieldsOf(guarded).ck).toBe('693');
    expect(noticeOf(guarded)).not.toContain('不再显示');
    expect(noticeOf(guarded)).toContain('仍按报告原样显示');
    // 重新识别 is advice about a hole in the data. There is no hole.
    expect(noticeOf(guarded)).not.toContain('重新识别');
  });

  it('says a withholding happened when one did', () => {
    const guarded = withholdUnsafeReadings(payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }));
    expect(noticeOf(guarded)).toContain('不再显示');
    expect(noticeOf(guarded)).toContain('重新识别');
    expect(noticeOf(guarded)).not.toContain('参考区间');
  });

  it('does not mention an interval on a payload that judged none', () => {
    const guarded = withholdUnsafeReadings(payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }));
    expect(noticeOf(guarded)).not.toContain('已标注');
  });

  it('names both when both happened', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '3', ck: '693', ldh: '693', ckmb: '40' },
        { analyteReferences: { ckmb: { low: null, high: 25 } } },
      ),
    );
    expect(noticeOf(guarded)).toContain('不再显示');
    expect(noticeOf(guarded)).toContain('参考区间');
  });

  it('says the duplicate could not be checked, not that it was checked and failed', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', alt: '32 U/L', ast: '32 U/L' }, { extractedText: '' }),
    );
    expect(noticeOf(guarded)).toContain('无法用报告原件核对');
    expect(noticeOf(guarded)).not.toContain('不再显示');
  });

  it('describes a contradiction between one analyte’s own spellings as such', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith({ fieldCount: '2', ldh: '9', table_ldh: '241' }),
    );
    expect(noticeOf(guarded)).toContain('两个互相矛盾的数值');
  });
});

/**
 * THE JOIN A SURFACE HAS TO MAKE. A screen holds a `fields` cell keyed
 * by SPELLING and has no way back to the canonical analyte name, so
 * `keys` is the contract — and the record must never carry the value it
 * withheld, or the deletion is theatre.
 */
describe('withholdUnsafeReadings — what a surface can do with the record', () => {
  it('names every spelling a flagged reading is rendered under', () => {
    const guarded = withholdUnsafeReadings(
      payloadWith(
        { fieldCount: '2', ck: '693 U/L', creatineKinase: '693 U/L', table_ck: '693 U/L' },
        { analyteReferences: { ck: { low: 50, high: 310 } } },
      ),
    );

    const marks = new Map<string, unknown>();
    for (const item of unsafeOf(guarded)) {
      for (const key of item.keys) marks.set(key, item);
    }

    expect([...marks.keys()].sort()).toEqual(['ck', 'creatineKinase', 'table_ck']);
    expect(Object.keys(fieldsOf(guarded))).toEqual(
      expect.arrayContaining(['ck', 'creatineKinase', 'table_ck']),
    );
  });

  it('never carries the number it withheld', () => {
    const guarded = withholdUnsafeReadings(payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }));
    expect(JSON.stringify(unsafeOf(guarded))).not.toContain('693');
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

/**
 * PATCH …/documents/:id/ocr IS THE SCREEN A PATIENT OPENS PRECISELY
 * BECAUSE THE REPORT LOOKS WRONG, and it handed the stored payload back
 * unguarded — so the correction screen brought back every reading the
 * rest of the product had stopped showing. The whitelisted cells a
 * patient may edit are not laboratory analytes; what came back was the
 * REST of the payload, carried along for the ride.
 */
describe('PatientProfileService.patchDocumentOcrFields', () => {
  const logger = {
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    child: () => logger,
  } as unknown as AppLogger;

  const serviceForPatch = (stored: unknown) => {
    const query = vi
      .fn()
      // The status/ownership read.
      .mockResolvedValueOnce({
        rows: [{ id: 'doc-1', status: 'parsed', ocr_payload: stored }],
        rowCount: 1,
      })
      // The write, RETURNING the row it just landed.
      .mockImplementationOnce(async (_sql: string, params: unknown[]) => ({
        rows: [{ id: 'doc-1', ocr_payload: JSON.parse(String(params[2])) }],
        rowCount: 1,
      }));
    const pool = { query, connect: vi.fn() } as never;
    return { service: new PatientProfileService({ pool, logger }), query };
  };

  const patchedPayload = (result: unknown) =>
    (result as { ocr_payload: unknown }).ocr_payload as Record<string, unknown>;

  it('guards the payload it echoes back to the correction screen', async () => {
    const { service } = serviceForPatch(payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }));

    const result = await service.patchDocumentOcrFields('user-1', 'doc-1', {
      reportTime: '2024-05-01',
    });

    expect(fieldsOf(patchedPayload(result)).ck).toBeUndefined();
    expect(fieldsOf(patchedPayload(result)).ldh).toBeUndefined();
    expect(unsafeOf(patchedPayload(result))).toHaveLength(2);
  });

  /** The patient's own correction has to come back, or the screen shows
   *  them the value they just replaced. */
  it('returns the cell the patient just corrected', async () => {
    const { service } = serviceForPatch(payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }));

    const result = await service.patchDocumentOcrFields('user-1', 'doc-1', {
      reportTime: '2024-05-01',
    });

    expect(fieldsOf(patchedPayload(result)).reportTime).toBe('2024-05-01');
    expect(fieldsOf(patchedPayload(result)).manuallyEditedAt).toEqual(expect.any(String));
  });

  /** WHAT IS STORED IS NOT WHAT IS SHOWN. The guard runs on the way
   *  out; the row keeps the readings so a reparse has something to
   *  compare against and something to put back. */
  it('writes the unguarded payload and guards only the response', async () => {
    const { service, query } = serviceForPatch(
      payloadWith({ fieldCount: '2', ck: '693', ldh: '693' }),
    );

    await service.patchDocumentOcrFields('user-1', 'doc-1', { reportTime: '2024-05-01' });

    const written = JSON.parse(String(query.mock.calls[1][1][2]));
    expect(written.fields.ldh).toBe('693');
    expect(written.unsafeReadings).toBeUndefined();
  });

  it('leaves a clean payload alone', async () => {
    const { service } = serviceForPatch(payloadWith({ fieldCount: '2', ck: '693', ldh: '241' }));

    const result = await service.patchDocumentOcrFields('user-1', 'doc-1', {
      reportTime: '2024-05-01',
    });

    expect(fieldsOf(patchedPayload(result)).ldh).toBe('241');
    expect(patchedPayload(result).unsafeReadings).toBeUndefined();
  });
});

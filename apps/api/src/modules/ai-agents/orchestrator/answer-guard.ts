/**
 * THE LAST PASS OVER WHAT LEAVES THE SERVER TOWARD THE PATIENT.
 *
 * `security/pii-redactor.ts` is the last pass over what leaves the
 * server toward the MODEL: one place, positioned last, deny-by-default,
 * and it states what it withheld rather than silently editing. This is
 * the same discipline pointed the other way, and it exists because the
 * other direction was never guarded at all.
 *
 * WHY A PROMPT RULE WAS NOT ENOUGH, MEASURED RATHER THAN ARGUED. The
 * previous round wrote the rules out explicitly. `CLINICAL_INFERENCE_BOUNDS`
 * in run.ts names 「1–3 个重复单元属于病情较严重的遗传基础」 as forbidden
 * and closes the hedge loophole in the same bullet
 * (「前面加上「通常」「往往」「可能」也一样不行——落在他的数字上它就是
 * 预测」); the methylation bullet says 「不要自己划一条线」. Driven against
 * the running stack with a synthetic patient carrying d4z4Repeats: '3',
 * haplotype: '4qA', methylationValue: '95%', the model broke both on the
 * patient's own numbers — the severity claim arrived inside a table
 * whose column header was 「对你个人的意义」 (so it was never a sentence
 * with 「你」 in it), and the methylation value was graded
 * (「95% 这个数值高出常规预期」). The rules are correctly written and the
 * model does not obey them. A rule that is only asserted is not a
 * control.
 *
 * WHAT EACH CHECK IS DERIVED FROM — none of them is a list of forbidden
 * claims, because a list of claims is what the prompt already is:
 *
 *   1. A severity / prognosis / progression / onset claim attached to
 *      THIS PATIENT'S number. The turn knows which numbers are theirs:
 *      they are in the projection this run built. A word list would have
 *      to guess; this asks whether the sentence carries one of *their*
 *      values (or a band containing it) next to a severity word.
 *   2. A grading of a cell this platform declines to grade. The turn
 *      knows which cells it graded: a cell that travelled with a
 *      `_clinical` sibling has this platform's reading, a cell that
 *      travelled without one does not, and methylation is permanently
 *      the second kind because no file in this repo states a boundary.
 *      So the guard does not carry a list of ungradable cells; it reads
 *      the projection and treats every reading-less cell the same way.
 *   3. A mechanism no retrieved source states. The turn holds the
 *      retrieved chunks. A causal sentence carrying no citation whose
 *      every 6-character shingle is absent from all of them was composed
 *      here, not read.
 *   4. A recommendation to go and acquire a measurement the record
 *      already holds. `numericValuesWithheld` is an absence produced by
 *      CONSENT, and the model read it as an absence of the finding —
 *      「但是，这里面没有甲基化的结果」 to a patient whose report says
 *      95%, followed by four indications for ordering the test. The turn
 *      knows the cell is on file: it is in the raw retriever payload and
 *      not in the rendered projection.
 *
 * WHAT IT DOES WHEN IT FIRES — see `GUARD_REGENERATION_DIRECTIVE` and
 * `EXCISION_NOTICE`. Briefly: regenerate once with the offending
 * sentences quoted back, and if the second answer still violates, excise
 * exactly those sentences and TELL THE PATIENT what was removed and why.
 * Refusing the whole answer was considered and rejected: this is a
 * patient who asked a direct question about their own report, this
 * platform's own readings of that report are legitimate answers to it,
 * and withholding them punishes the patient for the model's error. A
 * silent excision was rejected for the reason stated on
 * `markDegraded` — a caveat the patient cannot see is not a caveat.
 *
 * WHAT THIS FILE DOES NOT OWN, said loudly rather than quietly worked
 * around:
 *
 *   - THE LOCALISATION TABLE BELONGS IN security/, NOT HERE.
 *     `WIRE_TOKEN_ZH` maps this platform's wire vocabulary onto Chinese
 *     a patient can read. Those tokens are MINTED in
 *     security/pii-redactor.ts (`within_fshd1_repeat_range`,
 *     `permissive_haplotype`, the `GENETIC_READING_REFUSALS` set) and in
 *     security/render.ts (`numericValuesWithheld`, the block headings),
 *     and the Chinese for each belongs beside the token it names. It is
 *     here because those files are another lane's this round. The cost
 *     of that is exact and worth writing down: a reading label added
 *     over there does not fail to compile over here — it just reaches a
 *     patient as a snake_case identifier, which is the defect this
 *     table exists to fix. `answer-guard.test.ts` runs the real redactor
 *     over every genetics branch and fails when a label it emits has no
 *     entry here, which converts that silence into a red test but does
 *     not make the table's home correct.
 *   - THE CELL VOCABULARY (`CELL_TERMS`) is the same shape of borrowing:
 *     `pii-redactor.ts` already classifies a payload key onto a genetics
 *     cell (its `GeneticCellBranch` / `branchOf`), and this file asks the
 *     same question of the same keys with its own copy. Exporting that
 *     classifier is the fix.
 */

import { HARD_DELETE_KEYS_LOWER } from '../security/allowlist.js';

// ---------------------------------------------------------------- vocabulary

/**
 * Which genetics cell a payload key belongs to, and the words a Chinese
 * answer uses for that cell.
 *
 * NOT a list of the cells this guard governs — that comes from the
 * projection, one function down. This only answers 「the turn carried a
 * cell; what would a sentence about it look like」, which is a question
 * no derivation can answer for you: you cannot find a claim about
 * methylation without knowing the word 甲基化.
 *
 * `keyMatch` is matched case-insensitively as a substring of the payload
 * key, which is how `pii-redactor.ts` routes the same keys onto the same
 * four branches. See the note at the top of this file.
 */
const CELL_TERMS: Readonly<Record<string, { keyMatch: string; terms: readonly string[] }>> = {
  d4z4: { keyMatch: 'd4z4', terms: ['D4Z4', '重复数', '重复单元', '拷贝数'] },
  haplotype: { keyMatch: 'haplotype', terms: ['单倍型', '4qA', '4qB'] },
  methylation: { keyMatch: 'methylation', terms: ['甲基化'] },
  ecori: { keyMatch: 'ecori', terms: ['EcoRI', '片段长度'] },
};

const CELL_NAMES = Object.keys(CELL_TERMS);

/** The cell a payload key belongs to, or null for a key that is not a
 *  genetics cell at all (`gender`, `status`, `spanDays`…). */
const cellOfKey = (key: string): string | null => {
  const lower = key.toLowerCase();
  return CELL_NAMES.find((cell) => lower.includes(CELL_TERMS[cell].keyMatch)) ?? null;
};

/** Chinese for the cell, used in the excision notice. */
const CELL_LABEL_ZH: Readonly<Record<string, string>> = {
  d4z4: 'D4Z4 重复数',
  haplotype: '单倍型',
  methylation: '甲基化',
  ecori: 'EcoRI 片段长度',
};

/**
 * Keys whose numeric value is a CALENDAR or a TALLY rather than a
 * measurement of this patient's body.
 *
 * They are excluded from the number set because they are the numbers a
 * safe sentence is most likely to contain: 「2019 年确诊以来…」 pairs a
 * year with a progression word in every honest answer that mentions when
 * the patient was diagnosed. A measurement never appears that way.
 */
const NON_MEASUREMENT_KEY = /year|date|time|count|days|_at$|index|id$/i;

// ------------------------------------------------------------ wire tokens

/**
 * This platform's wire vocabulary, in Chinese.
 *
 * Every one of these was OBSERVED reaching a patient verbatim. Driven
 * against the running stack: 「单倍型是 4qA，属于「允许型」（permissive）」,
 * 「你的报告里有些字段标注了 `not_read_off_a_laboratory_report`」 — followed
 * by the model's own invented gloss of what that token means — and
 * 「目前上传的是基因检测报告（genetic_report）」.
 *
 * Substitution rather than a violation, deliberately. A wire token in
 * the answer is a RENDERING fault, not a claim the platform forbids:
 * the sentence around it is usually correct and the patient is entitled
 * to it. Regenerating for it would spend an LLM call to fix a string
 * replacement, and excising it would delete a true sentence. So the
 * guard rewrites the token in place and records that it did.
 *
 * Ordered longest-first at use, so
 * `within_fshd1_repeat_range_grey_zone_8_to_10` is not half-consumed by
 * `within_fshd1_repeat_range`.
 */
export const WIRE_TOKEN_ZH: Readonly<Record<string, string>> = {
  // --- readings (minted in pii-redactor.ts `clinicaliseD4Z4` / `clinicaliseHaplotype`)
  within_fshd1_repeat_range_grey_zone_8_to_10: '这个重复数落在 8–10 这段说不准的区间里',
  within_fshd1_repeat_range: '这个重复数落在 FSHD1 的范围里',
  above_fshd1_repeat_range: '这个重复数在 FSHD1 的范围之上',
  permissive_haplotype: '允许型单倍型',
  non_permissive_haplotype: '非允许型单倍型',
  // --- refusals (pii-redactor.ts `GENETIC_READING_REFUSALS`)
  not_read_off_a_laboratory_report: '本平台没有把这一格当成化验报告上的读数',
  length_in_kb_not_a_repeat_count: '这一格记的是长度（kb），不是重复单元数',
  other_allele_not_the_contracted_one: '这一格是另一条等位基因，不是收缩的那一条',
  repeat_count_not_read_against_fshd1_range_non_permissive_haplotype:
    '同一份报告写的是非允许型，所以本平台没有拿这个重复数去对 FSHD1 的范围',
  zero_repeat_count_not_a_valid_reading: '这一格写的是 0，本平台不把它当成有效读数',
  unspecified_haplotype: '这一格没有写明是哪一型',
  unspecified: '这一格没有写明',
  // --- projection bookkeeping (render.ts / pii-redactor.ts)
  numericValuesWithheld: '按当前授权扣下的测量值个数',
  fieldsDroppedAsUnsafe: '因为无法确认而没有发出的格子数',
  methylation_withheld: '甲基化数值（有结果在案，按当前授权没有发出）',
  value_withheld: '有结果在案，按当前授权没有发出',
  fields_clinical: '本平台对报告字段的判读',
  classifiedType: '报告类型',
  genetic_report: '基因检测报告',
};

/**
 * A bare English word this platform never says to a patient, handled
 * separately from the snake_case tokens because it is a WORD and a
 * substring rule would eat `permissive_haplotype`'s tail.
 */
const BARE_WIRE_WORD: Readonly<Record<string, string>> = {
  permissive: '允许型',
  'non-permissive': '非允许型',
};

const WIRE_TOKENS_LONGEST_FIRST = Object.keys(WIRE_TOKEN_ZH).sort((a, b) => b.length - a.length);

/** Substitute this platform's wire vocabulary for Chinese. Returns the
 *  rewritten text and the tokens that were actually present. */
export const localiseWireTokens = (answer: string): { text: string; tokens: string[] } => {
  let text = answer;
  const tokens: string[] = [];
  for (const token of WIRE_TOKENS_LONGEST_FIRST) {
    if (!text.includes(token)) continue;
    tokens.push(token);
    text = text.split(token).join(WIRE_TOKEN_ZH[token]);
  }
  for (const [word, zh] of Object.entries(BARE_WIRE_WORD)) {
    const pattern = new RegExp(`(?<![0-9A-Za-z_-])${word}(?![0-9A-Za-z_-])`, 'gi');
    if (!pattern.test(text)) continue;
    tokens.push(word);
    text = text.replace(pattern, zh);
  }
  return { text, tokens };
};

// ------------------------------------------------------------- the evidence

/** One of this patient's own values, and which cell it came from. */
export interface PatientNumber {
  value: number;
  /** The genetics cell it belongs to, or null for any other measurement. */
  cell: string | null;
}

/**
 * What the turn holds, in the shape the checks ask questions of.
 *
 * Assembled by `buildGuardEvidence` from things the run already has: the
 * raw retriever payloads for the patient's own numbers, the rendered
 * rows for what this platform said about them, and the retrieved chunks
 * for what a source states.
 */
export interface GuardEvidence {
  /** Every measurement on this patient's record, whether or not consent
   *  let it travel. A number the model never saw cannot be one it
   *  reasoned from, so including it costs nothing and closes the case
   *  where the value reached the model through replayed history. */
  numbers: readonly PatientNumber[];
  /** Cells that travelled WITHOUT this platform's reading beside them.
   *  Methylation is permanently one; anything else here is a cell whose
   *  `_clinical` sibling the redactor declined to write this turn. */
  ungradedCells: readonly string[];
  /** Cells the record holds a value for that did NOT reach the prompt.
   *  An absence produced by consent, which must never be reported as an
   *  absence of the finding. */
  withheldCells: readonly string[];
  /** 6-character shingles of every retrieved non-patient chunk. Empty
   *  when nothing was retrieved, which disables the mechanism check —
   *  see `CORPUS_UNAVAILABLE_NOTICE` in run.ts, which is the control
   *  that already covers that case. */
  corpusShingles: ReadonlySet<string>;
  corpusChunkCount: number;
}

/**
 * MEASURED, NOT PICKED. Against the live corpus for
 * 「FSHD D4Z4 重复数 甲基化 机制 DUX4 病情严重程度」 (8 chunks, 7,460
 * chars), the fraction of a sentence's n-grams present in the retrieval:
 *
 *                                        n=4     n=5     n=6
 *   invented 「代偿性地维持在高度甲基化的状态」  0.000   0.000   0.000
 *   invented 「代偿性高甲基化状态」              0.000   0.000   0.000
 *   textbook 「D4Z4 松散 → DUX4 激活 → 肌肉病变」 0.051   0.000   0.000
 *   textbook 「因为 D4Z4 重复数缩短导致的 FSHD」  0.152   0.089   0.045
 *
 * At n=6 the textbook sentences score zero too, which is why this check
 * excised two correct paraphrases of the FSHD mechanism from live
 * answers. Only n=4 separates them, and only barely — so the test is
 * 「NOT ONE 4-gram in common」, the most permissive form of it, rather
 * than a coverage threshold the numbers above do not support.
 *
 * WHAT THAT COSTS, stated: a Chinese-heavy retrieval gives an invented
 * sentence more chances to share a 4-gram, so this check misses more
 * than it catches and is the weakest of the four. It fails toward
 * silence, which is the correct direction for a check whose false
 * positive is deleting a true sentence about the patient's disease.
 */
const SHINGLE = 4;
const CJK = /[\u4e00-\u9fff]/u;

/** Content characters only: punctuation, spaces and markdown furniture
 *  are layout rather than words, and a shingle that spans them matches
 *  nothing useful. */
const contentChars = (text: string): string =>
  [...text].filter((ch) => CJK.test(ch) || /[0-9A-Za-z]/u.test(ch)).join('');

const shinglesOf = (text: string): string[] => {
  const chars = contentChars(text);
  if (chars.length < SHINGLE) return [];
  const out: string[] = [];
  for (let i = 0; i + SHINGLE <= chars.length; i += 1) out.push(chars.slice(i, i + SHINGLE));
  return out;
};

/**
 * Walk a raw retriever payload for this patient's measurements.
 *
 * `HARD_DELETE_KEYS_LOWER` is skipped first: those keys hold telephone
 * numbers, record numbers and identity documents, which are numbers this
 * function would otherwise put in the set and then match against any
 * digits in the answer. They never reach a prompt, so they can never be
 * a number the model reasoned from either.
 *
 * A value counts only when it is a NUMBER — 「3」, 「95%」, 「12.4 kb」 —
 * and not when it is an identifier that merely contains digits. 「4qA」
 * would otherwise contribute 4, and every sentence containing a bare 4
 * beside a severity word would read as a claim about this patient's
 * haplotype.
 */
const NUMERIC_VALUE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(%|kb|KB|个|次|分|岁)?\s*$/u;

const collectNumbers = (value: unknown, key: string, depth: number, out: PatientNumber[]): void => {
  if (depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, key, depth + 1, out);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
      if (HARD_DELETE_KEYS_LOWER.has(innerKey.toLowerCase())) continue;
      collectNumbers(innerValue, innerKey, depth + 1, out);
    }
    return;
  }
  if (NON_MEASUREMENT_KEY.test(key)) return;
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  if (raw === null) return;
  const match = NUMERIC_VALUE.exec(raw);
  if (!match) return;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return;
  out.push({ value: parsed, cell: cellOfKey(key) });
};

/**
 * The rows the projection printed, as the two questions the checks ask
 * of them.
 *
 * `fields` and `ocrKeys` are exactly `readEmission`'s output in run.ts —
 * the rows the tool messages carried, cross-checked against what the
 * projection published. Passed in rather than recomputed so there is one
 * reading of the tool messages per turn and both readers see the same
 * rows.
 */
export interface EmittedRows {
  fields: ReadonlySet<string>;
  ocrKeys: ReadonlySet<string>;
}

export interface BuildGuardEvidenceInput {
  /** Raw `metadata.fields` of every chunk a PATIENT-scoped retriever
   *  returned this turn. */
  patientPayloads: readonly Record<string, unknown>[];
  emitted: EmittedRows;
  /** `content` of every chunk a non-patient retriever returned. */
  corpusTexts: readonly string[];
}

export const buildGuardEvidence = (input: BuildGuardEvidenceInput): GuardEvidence => {
  const numbers: PatientNumber[] = [];
  for (const payload of input.patientPayloads) collectNumbers(payload, '', 0, numbers);

  // Which cells this platform graded, and which it merely printed. Both
  // sets are read off the SAME rows: a `_clinical` row is this
  // platform's reading of a cell, and a cell with any other row and no
  // `_clinical` row is one it declined to read.
  const printedKeys = [...input.emitted.fields, ...input.emitted.ocrKeys];
  const graded = new Set<string>();
  const printed = new Set<string>();
  for (const key of printedKeys) {
    const cell = cellOfKey(key);
    if (cell === null) continue;
    printed.add(cell);
    if (key.endsWith('_clinical')) graded.add(cell);
  }
  const ungradedCells = [...printed].filter((cell) => !graded.has(cell));

  // A cell the RECORD holds a value for and the PROMPT does not carry.
  // Read off the raw payload against the printed rows, which is the only
  // pairing that can tell 「consent withheld it」 from 「there is no such
  // cell」 — the distinction the model got backwards.
  const onFile = new Set<string>();
  const walk = (value: unknown, key: string, depth: number): void => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [innerKey, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (HARD_DELETE_KEYS_LOWER.has(innerKey.toLowerCase())) continue;
        walk(innerValue, innerKey, depth + 1);
      }
      return;
    }
    if (value === null || value === undefined || value === '') return;
    const cell = cellOfKey(key);
    if (cell !== null) onFile.add(cell);
  };
  for (const payload of input.patientPayloads) walk(payload, '', 0);

  // A cell whose ONLY printed rows are a reading or a withheld statement
  // has no value in the prompt. `_clinical` is a reading of the cell, not
  // the cell: strict mode prints `d4z4Repeats_clinical` and drops the
  // count, and 「你的重复数报告里没写」 would be as false as the
  // methylation sentence.
  const valuePrinted = new Set<string>();
  for (const key of printedKeys) {
    const cell = cellOfKey(key);
    if (cell === null) continue;
    if (key.endsWith('_clinical') || key.endsWith('_withheld') || key.endsWith('_origin')) continue;
    valuePrinted.add(cell);
  }
  const withheldCells = [...onFile].filter((cell) => !valuePrinted.has(cell));

  const corpusShingles = new Set<string>();
  for (const text of input.corpusTexts) {
    for (const shingle of shinglesOf(text)) corpusShingles.add(shingle);
  }

  return {
    numbers,
    ungradedCells,
    withheldCells,
    corpusShingles,
    corpusChunkCount: input.corpusTexts.length,
  };
};

// ------------------------------------------------------------------ segments

/**
 * The unit the guard judges and, when it has to, removes.
 *
 * A LINE when the line is a table row or a heading, a SENTENCE
 * otherwise. The table case is not a nicety: the observed severity
 * violation was a table cell under the header 「对你个人的意义」, and a
 * table cell is not a sentence — it has no 。 and no 你, and splitting on
 * punctuation would have judged 「1–3 个重复单元属于病情较严重的遗传基础」
 * as a fragment of the row above it. Removing half a row would also
 * leave a broken table on the patient's screen.
 */
interface Segment {
  text: string;
  start: number;
  end: number;
}

const SENTENCE_END = /[。！？；!?;]/u;

const segmentsOf = (answer: string): Segment[] => {
  const segments: Segment[] = [];
  let lineStart = 0;
  for (const line of answer.split('\n')) {
    const trimmed = line.trim();
    const isRowOrHeading = trimmed.startsWith('|') || trimmed.startsWith('#');
    if (trimmed.length > 0) {
      if (isRowOrHeading) {
        segments.push({ text: line, start: lineStart, end: lineStart + line.length });
      } else {
        let cursor = 0;
        let sentenceStart = 0;
        for (const ch of line) {
          cursor += ch.length;
          if (!SENTENCE_END.test(ch)) continue;
          const text = line.slice(sentenceStart, cursor);
          if (text.trim())
            segments.push({ text, start: lineStart + sentenceStart, end: lineStart + cursor });
          sentenceStart = cursor;
        }
        if (sentenceStart < line.length) {
          const text = line.slice(sentenceStart);
          if (text.trim())
            segments.push({ text, start: lineStart + sentenceStart, end: lineStart + line.length });
        }
      }
    }
    lineStart += line.length + 1;
  }
  return segments;
};

// ------------------------------------------------------------------- checks

/**
 * The words that turn a value into a prediction.
 *
 * A LEXICON, and it has to be: 「严重」 is not derivable from anything the
 * turn holds. What IS derived is the other half of every rule below —
 * whose number the sentence is about, and whether this platform graded
 * the cell. A lexicon alone would flag every sentence in a disease
 * encyclopedia; it fires here only when it lands on the patient's own
 * value.
 */
const SEVERITY_WORD =
  /严重|重症|轻重|轻型|重型|预后|进展|恶化|加重|发病早|早发|晚发|越早|越重|越快|更快|更重|更早|病程|残疾|轮椅|走不了|失能|寿命|活不|发病年龄|表型更/u;

/**
 * The escape the prompt explicitly grants: a cohort statement said AS a
 * cohort statement. `CLINICAL_INFERENCE_BOUNDS` allows exactly this
 * (「群体层面的结论要说成群体层面的」), so the guard must not delete it —
 * the population trend is real, publishable, and is most of what an
 * honest answer to 「重复数少是不是更重」 consists of.
 */
const POPULATION_MARKER =
  /群体|人群|队列|研究|文献|指南|报道|数据显示|平均|统计|总体上|一般来说|在这项/u;

/**
 * ...and the other thing that is not a prediction: the model REFUSING to
 * make one, or handing the question to a clinician.
 *
 * Both were excised in a live run, which is the worst possible outcome
 * for this check — the sentence removed was the platform's own position,
 * stated correctly, in the model's voice:
 *
 *   「我不能把你的 3 个重复单元、95% 甲基化值拿来判断「你病情严重不严重」」
 *   「至于 95% 这个数值对你的病情具体意味着什么，建议跟你的主治医生讨论」
 *
 * Both carry the patient's number and a severity word and neither is a
 * claim. `CLINICAL_INFERENCE_BOUNDS` asks for exactly these two moves,
 * so a guard that deletes them is enforcing the opposite of the rule.
 */
const CLAIM_DISCLAIMED =
  /不能|不会|无法|没法|没能|没办法|不做|不是对|不要自己|不是用来|不能用来|不作为|不足以|说不准|由医生|请医生|主治医生|问医生|医生判断|医生评估/u;

/** Words that put a cell on a scale. Paired with a cell the platform
 *  declined to grade, this is the platform drawing a line it refuses to
 *  draw. */
const GRADING_WORD =
  /偏高|偏低|过高|过低|很高|很低|太高|太低|极高|极低|相当高|非常高|高出|低于|超出|超标|异常|正常范围|明显升高|明显降低|属于高|属于低|高甲基化|低甲基化|分级|哪一档|这一档|程度很|水平很|读成|比较少见|不太常见/u;

/** A negation reaching FORWARD over the grading word. 「我没办法把这个数值
 *  解读成「高」或「低」」 is a refusal to grade and must survive; 「95% 高出
 *  常规预期，我没有办法解释」 is a grade followed by a disclaimer and must
 *  not. Position is what separates them, so the marker only cancels a
 *  grading word that comes after it. */
const NEGATION = /不|没|无法|拒绝|未|别|勿/u;

/**
 * A sentence ASSERTING a cause.
 *
 * 「机制」 on its own is the word, not the claim, and admitting it made
 * the check fire on a sentence that proposed nothing: driven against the
 * stack, 「我再帮你查一下知识库，看看有没有关于这家检测机构的甲基化检测
 * 方法或者相关机制的解释」 — a search preamble — was read as an invented
 * mechanism and excised. So the word only counts when it is followed by
 * the shape that turns it into an assertion (机制是 / 的机制在于 /
 * 机制上).
 *
 * BARE 「因为」 IS GONE for the same reason: it is a discourse connective
 * before it is a causal claim, and
 * 「因为即使是相同的重复数，不同的人病情也可能很不一样」 — a caveat
 * saying the opposite of a mechanism — was excised from a live answer on
 * it. 「是因为」 stays, because that one is an assertion.
 */
const CAUSAL_MARKER = /由于|导致|引起|造成|代偿|使得|是因为|所致|机制(?:是|上|在于)/u;

/** A sentence that says the record lacks something.
 *
 *  `(?<!有)` because 「有没有」 is a QUESTION.
 *  「如果你想了解目前有没有甲基化筛查的项目正在进行」 was removed from a
 *  live answer on the 没有 inside it. */
const ABSENCE_MARKER = /(?<!有)没有|不含|未包含|缺少|没做|未做|查不到|未检出这一项|报告里没/u;

/** How close an absence word has to stand to the cell it is denying.
 *
 *  Without it, any 没有 anywhere in a sentence that also mentions the
 *  cell counted: 「至于「是否需要再做甲基化检测」，这个没有标准答案，需要
 *  结合你的具体情况来判断」 denies nothing about the report and was
 *  removed from a live answer. 「你的报告里确实没有甲基化的结果」 puts
 *  the two characters apart. */
const ABSENCE_PROXIMITY = 8;

/**
 * ...unless the sentence already says WHY it cannot see the value.
 *
 * 「具体数值系统没有显示出来（按当前授权扣下的测量值个数: 1）」 is the
 * true statement, and it contains 没有. Flagging it would push the model
 * off the one wording that is correct here and toward saying nothing at
 * all, which is the opposite of what this check is for: the defect is
 * 「报告里没有」, not 「我这边看不到」.
 */
const CONSENT_AWARE = /授权|隐私设置|精确数值|没有显示|未显示|扣下|没发给|没有发给|看不到原始/u;

/**
 * A sentence RECOMMENDING the patient go and get a test — as opposed to
 * one restating the question they asked.
 *
 * 「需要」 and 「可以」 were in here, and 「至于「是否需要再做甲基化检测」，
 * 这个问题没有标准答案」 was removed from a live answer to a patient
 * whose own question was 「需不需要再去做一个甲基化检测？」. Engaging with
 * the question they asked is not the defect; the defect is telling them
 * the report lacks the value, and then sending them to buy it again. So
 * only the advisory shapes count.
 */
const ACQUIRE_MARKER =
  /建议(?:你|您)?(?:再|去|做|查|加做)|最好(?:再|去)?(?:做|查)|应该(?:再|去)?(?:做|查)|可以去(?:做|查)|去补(?:做|查)/u;

const TEST_MARKER = /检测|检查|化验|测一下|做一个/u;

export type ClinicalViolationKind =
  | 'severity_from_patient_number'
  | 'ungraded_cell_graded'
  | 'unsourced_mechanism'
  | 'retest_of_a_value_on_file';

export interface ClinicalViolation {
  kind: ClinicalViolationKind;
  /** Verbatim, so the regeneration can quote it back and the excision
   *  can find it again. */
  sentence: string;
  /** The fact from THIS TURN that makes it a violation, in Chinese,
   *  because it is quoted to the model and summarised to the patient. */
  because: string;
}

/** Does the segment carry this number as a number, rather than as part
 *  of an identifier? 「FSHD1」 must not match 1 and 「D4Z4」 must not
 *  match 4 — both appear in every correct answer about this patient. */
const carriesNumber = (segment: string, value: number): boolean => {
  const literal = Number.isInteger(value) ? String(value) : String(value);
  // 「/」 is a boundary too. 「没有统一的 Stage 1/2/3 之类的分期」 — a
  // sentence saying this platform has NO severity ladder — was removed
  // from a live answer because its 3 was read as the patient's repeat
  // count.
  const pattern = new RegExp(`(?<![0-9A-Za-z./])${literal}(?![0-9A-Za-z./])`, 'u');
  return pattern.test(segment);
};

/** ...or a band containing it. 「属于 1–3 个单元的范围」 never prints the
 *  patient's 3 as a standalone token in some phrasings, and the band is
 *  the same claim about the same person. */
const BAND =
  /(?<![0-9A-Za-z.])([0-9]+(?:\.[0-9]+)?)\s*(?:-|–|—|~|～|到|至)\s*([0-9]+(?:\.[0-9]+)?)(?![0-9A-Za-z.])/gu;

const carriesBandAround = (segment: string, value: number): boolean => {
  BAND.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BAND.exec(segment)) !== null) {
    const low = Number(match[1]);
    const high = Number(match[2]);
    if (Number.isFinite(low) && Number.isFinite(high) && value >= low && value <= high) return true;
  }
  return false;
};

/**
 * Is the grading word cancelled by something standing in front of it?
 *
 * Two things cancel it and both have to reach FORWARD, because position
 * is the only thing separating them from the assertion:
 *   - a NEGATION —「我没办法把这个数值解读成「高」或「低」」 is a refusal
 *     to grade and has to survive.
 *   - an INTERROGATIVE —「95% 这个数值具体代表什么、是否异常、是否提示
 *     更重或更轻的表型——建议你拿着报告去问你的主治医生」 was removed
 *     from a live answer. 「是否异常」 is the question being handed to a
 *     clinician, not a verdict.
 */
const INTERROGATIVE =
  /是否|是不是|有没有|算不算|会不会|意味着什么|代表什么|说明什么|哪一|哪个|哪种|吗/u;

const gradingIsNotAsserted = (segment: string): boolean => {
  const grading = segment.search(GRADING_WORD);
  if (grading < 0) return false;
  const before = segment.slice(0, grading);
  return NEGATION.test(before) || INTERROGATIVE.test(before);
};

const cellTermsPresent = (segment: string, cell: string): boolean =>
  CELL_TERMS[cell]?.terms.some((term) => segment.includes(term)) ?? false;

/** Does `pattern` match within `ABSENCE_PROXIMITY` characters of one of
 *  this cell's names? See `ABSENCE_PROXIMITY`. */
const nearACellTerm = (segment: string, cell: string, pattern: RegExp): boolean => {
  for (const term of CELL_TERMS[cell]?.terms ?? []) {
    let from = segment.indexOf(term);
    while (from >= 0) {
      const window = segment.slice(
        Math.max(0, from - ABSENCE_PROXIMITY),
        from + term.length + ABSENCE_PROXIMITY,
      );
      if (pattern.test(window)) return true;
      from = segment.indexOf(term, from + term.length);
    }
  }
  return false;
};

/**
 * Inspect one finished answer. Pure: it reports, it does not rewrite.
 */
/**
 * A leading 「关于X，」 names the topic; it does not assert X.
 *
 * 「关于病情严重程度，**你的 D4Z4 重复数是 3 个**，这个重复数**落在
 * FSHD1 的范围里**」 was removed from a live answer: the severity word
 * is in the heading clause and the sentence itself is this platform's
 * own reading, read back verbatim — the one thing that must always reach
 * the patient. Stripped before the severity test, so
 * 「关于你的重复数，3 个属于病情较严重的一档」 is still caught: there the
 * severity word is in the part that remains.
 */
const TOPIC_CLAUSE = /^\s*(?:关于|至于|说到|谈到|针对)[^，。；]{0,20}[，:：]/u;

/** A bullet or a numbered item, which is a CONTINUATION of the sentence
 *  above it rather than a statement standing on its own. */
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)、])\s/u;

export const inspectAnswer = (answer: string, evidence: GuardEvidence): ClinicalViolation[] => {
  const violations: ClinicalViolation[] = [];
  const seen = new Set<string>();
  const add = (violation: ClinicalViolation): void => {
    const key = `${violation.kind}:${violation.sentence}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(violation);
  };

  // A LIST INHERITS ITS LEAD-IN'S FRAMING, because a reader does.
  //
  // 「在群体研究中，1–3 个重复单元是较短的 D4Z4 阵列。研究显示：」 followed
  // by 「- 1–3 个重复单元的患者更有可能属于「早发型」FSHD…」 is one
  // cohort statement written across two lines, and the second line was
  // removed from a live answer for not repeating the word 群体 inside
  // itself. The framing is in the sentence that opened the list, so a
  // list item is judged with it.
  let leadInIsPopulation = false;

  for (const segment of segmentsOf(answer)) {
    const text = segment.text;
    const isListItem = LIST_ITEM.test(text);
    if (!isListItem && text.trim()) leadInIsPopulation = POPULATION_MARKER.test(text);
    const populationFramed = POPULATION_MARKER.test(text) || (isListItem && leadInIsPopulation);

    // 1. A severity claim landing on one of this patient's own numbers.
    const asserted = text.replace(TOPIC_CLAUSE, '');
    if (SEVERITY_WORD.test(asserted) && !populationFramed && !CLAIM_DISCLAIMED.test(text)) {
      const hit = evidence.numbers.find(
        (number) => carriesNumber(text, number.value) || carriesBandAround(text, number.value),
      );
      if (hit) {
        add({
          kind: 'severity_from_patient_number',
          sentence: text.trim(),
          because: `这句把「${hit.value}」——他本人档案/报告里的数值——和病情轻重、进展或发病早晚绑在了一起，而且没有说明这是群体层面的结论。`,
        });
      }
    }

    // 2. A grade on a cell this platform declines to grade.
    if (!gradingIsNotAsserted(text) && GRADING_WORD.test(text)) {
      for (const cell of evidence.ungradedCells) {
        const byNumber = evidence.numbers.some(
          (number) => number.cell === cell && carriesNumber(text, number.value),
        );
        // NEAR the cell, not merely somewhere in the same sentence.
        // 「FSHD1 通常表现为 D4Z4 区域的低甲基化，但具体的数值解读需要结合
        // 你的临床表型一起看」 was removed from a live answer: the 你的
        // belongs to 临床表型, seventeen characters away, and the grading
        // word belongs to a general statement about FSHD1.
        const byName = nearACellTerm(text, cell, /你的|您的|你这|本人/u);
        if (!byNumber && !byName) continue;
        add({
          kind: 'ungraded_cell_graded',
          sentence: text.trim(),
          because: `本轮工具消息里「${CELL_LABEL_ZH[cell] ?? cell}」这一格没有带本平台的判读（没有 _clinical），本平台对这一格不下结论；这句话给它划了一条线。`,
        });
      }
    }

    // 3. A mechanism no retrieved chunk states.
    //
    // NOT ASKED OF A TABLE CELL OR A FRAGMENT, because lexical overlap
    // cannot answer it there. A cell is a gloss — 「4qA | 这是允许型单倍
    // 型——意味着你的 D4Z4 收缩是能导致 FSHD 的类型」 — with a handful of
    // shingles and no room for the phrasing the corpus happens to use,
    // and two such cells were excised in a live run for restating this
    // platform's own `permissive_haplotype` reading in plain Chinese.
    // The severity and grading checks still cover table rows, which is
    // where the claim that matters in a table actually lives.
    const isTableRow = text.trim().startsWith('|');
    if (
      evidence.corpusChunkCount > 0 &&
      !isTableRow &&
      contentChars(text).length >= 15 &&
      CAUSAL_MARKER.test(text) &&
      !/\[[0-9]/u.test(text) &&
      (/(FSHD|DUX4|SMCHD1)/iu.test(text) || CELL_NAMES.some((cell) => cellTermsPresent(text, cell)))
    ) {
      const shingles = shinglesOf(text);
      const supported = shingles.some((shingle) => evidence.corpusShingles.has(shingle));
      if (shingles.length > 0 && !supported) {
        add({
          kind: 'unsourced_mechanism',
          sentence: text.trim(),
          because:
            '这句给出了一个机制解释，但本轮检索到的片段里没有任何一段写过它，也没有标出处编号。',
        });
      }
    }

    // 4. Telling the patient a value they have is missing, or to go get
    //    it again.
    for (const cell of evidence.withheldCells) {
      if (!cellTermsPresent(text, cell)) continue;
      if (CONSENT_AWARE.test(text)) continue;
      const saysMissing = nearACellTerm(text, cell, ABSENCE_MARKER);
      // A referral is not a recommendation. 「你可以跟主治医生聊一聊，听听
      // 他对你的具体情况是否建议做甲基化检测」 hands the decision to a
      // clinician, which is what this platform asks for everywhere else;
      // the defect is telling the patient to go and buy a result they
      // already have. NOT applied to `saysMissing`: 「你的报告里没有甲基
      // 化结果，建议问医生」 is still a false statement about the report.
      const saysGetIt =
        ACQUIRE_MARKER.test(text) &&
        !CLAIM_DISCLAIMED.test(text) &&
        nearACellTerm(text, cell, TEST_MARKER);
      if (!saysMissing && !saysGetIt) continue;
      add({
        kind: 'retest_of_a_value_on_file',
        sentence: text.trim(),
        because: `「${CELL_LABEL_ZH[cell] ?? cell}」这一格在他的记录里是有结果的，只是当前授权没有把数值发给你——这是授权造成的看不见，不是报告里没有。`,
      });
    }
  }

  return violations;
};

// ------------------------------------------------------------------ remedy

/**
 * The instruction the regeneration round carries.
 *
 * QUOTED BACK, NOT DESCRIBED. The prompt already describes the rule in
 * `CLINICAL_INFERENCE_BOUNDS` and the model read it and broke it anyway;
 * repeating the description is the move that has already failed twice.
 * What this adds is the model's OWN sentence and the fact about THIS
 * turn that makes it wrong, which is the one thing the system prompt
 * could not contain.
 */
export const buildRegenerationDirective = (violations: readonly ClinicalViolation[]): string =>
  [
    '【这条回答不能发给用户，请重写一遍】',
    '你刚才写的回答里有下面这些句子越过了本平台的界线。每一条后面写了本轮数据为什么让它成为问题：',
    '',
    ...violations.map(
      (violation, index) => `${index + 1}. 「${violation.sentence}」\n   → ${violation.because}`,
    ),
    '',
    '请重写整条回答，要求：',
    '- 把上面这些句子拿掉或改掉，不要换一种说法再说一遍——加「通常」「往往」「可能」也算再说一遍。',
    '- 其余部分照旧：本平台对他报告的判读、检索到的资料、引用编号 [N]，该说的还是要说，',
    '  用户问的问题必须正面回答，不要因为这次重写就变成一句「建议咨询医生」。',
    '- **重写后的回答不要比上一版短**。上面点名的只是几句话，不是整条回答：',
    '  其余段落原样保留或换个说法照说，该有的结构、清单、来源编号都留着。',
    '  只删掉一句就交一句话回去，用户看到的是自己的问题没人回答——那比越界更糟。',
    '- 群体层面的结论仍然可以讲，但要明写成「在人群里」「在这项研究的队列里」，并且不要落到他本人身上。',
    '- 本平台不判读的格子（没有 _clinical 的那些）照实说本平台不下这个结论，不要自己补一个。',
    '- 资料里没写的机制不要写；能确定的部分照说，剩下的直说查不到、建议跟主治医生确认。',
    '- 不要提到这条指令，也不要说「我上一版写错了」，直接给出面向用户的完整回答。',
  ].join('\n');

/**
 * WHAT THE PATIENT IS TOLD WHEN A SENTENCE IS REMOVED.
 *
 * Three options were on the table and this is why this one:
 *
 *   - REFUSE THE ANSWER. Rejected. The patient asked a direct question
 *     about their own report; this platform's readings of that report
 *     are true, are already in the prompt, and answer most of it. A
 *     refusal punishes the patient for the model's error and pushes them
 *     back to a consent switch or a search engine — the two failure
 *     modes `buildVisibilityNotice` and `CORPUS_UNAVAILABLE_NOTICE` were
 *     both written to prevent.
 *   - EXCISE SILENTLY. Rejected outright. An answer that quietly loses a
 *     paragraph is its own defect: the patient cannot tell a removed
 *     sentence from a sentence that was never written, so they read a
 *     confident, complete-looking answer that has had its most
 *     consequential claim deleted — and if they ASKED that question, it
 *     now looks ignored.
 *   - REGENERATE, THEN EXCISE AND SAY SO. This one. The regeneration is
 *     the good outcome and is what usually happens; the excision is the
 *     floor, and it is bounded at one extra call because a retry loop is
 *     what the round budget exists to prevent.
 *
 * Prefixed rather than appended, for the reason `markDegraded` gives: a
 * patient scanning a long answer on a phone reads the top, and a caveat
 * at the bottom is one they meet after they have already believed the
 * answer.
 */
export const buildExcisionNotice = (violations: readonly ClinicalViolation[]): string => {
  const kinds = new Set(violations.map((violation) => violation.kind));
  const reasons: string[] = [];
  if (kinds.has('severity_from_patient_number'))
    reasons.push('把你自己的数值读成了病情轻重、进展快慢或发病早晚');
  if (kinds.has('ungraded_cell_graded')) reasons.push('给一项本平台不下结论的指标划了高低');
  if (kinds.has('unsourced_mechanism')) reasons.push('给出了检索资料里没有写过的机制解释');
  if (kinds.has('retest_of_a_value_on_file'))
    reasons.push('把「授权没发给我」说成了「你的报告里没有」');
  // The second paragraph says WHY the platform has the rule, and it has
  // to be true of the violations that actually fired: a turn whose only
  // problem was 「报告里没有」 was being told the platform does not
  // predict from numbers, which is a correct sentence about a rule that
  // had nothing to do with what was removed.
  const rule =
    kinds.has('severity_from_patient_number') || kinds.has('ungraded_cell_graded')
      ? '本平台不会拿某一个人的数字去预测他的病情，也不会替自己不判读的格子下结论——'
      : kinds.has('retest_of_a_value_on_file')
        ? '你那一项是有结果的，只是按你当前的授权没有发到我这边来——'
        : '没有资料出处的机制解释，我不能当成你报告的解释讲给你——';
  return (
    `⚠️ 这条回答里有 ${violations.length} 处被我删掉了，原因是它们${reasons.join('；')}。\n\n` +
    rule +
    '这是平台的规矩，不是你的问题不该问。上面留下来的是本平台对你报告的判读和检索到的资料，' +
    '被删掉的那部分，最好带着报告直接问你的主治医生。'
  );
};

/**
 * Everything survived being cut. Rather than hand back a blank bubble,
 * say what happened and point at the answer that IS available — this
 * platform's own reading of the report, which is in the prompt and is
 * what the patient asked about.
 */
export const EMPTY_AFTER_EXCISION_FALLBACK =
  '这次我写出来的回答整段都越过了本平台的界线（拿你的数值去推病情轻重、或者给不判读的指标下了结论），' +
  '所以我没有把它发给你。\n\n' +
  '能告诉你的是本平台对你报告的判读本身——比如「我的重复数在不在 FSHD1 的范围里」' +
  '「我的单倍型是不是允许型」这类问题，直接问我就行，我照着报告回答。' +
  '至于病情会怎么走、这些数字对你个人意味着什么，本平台不做这个判断，建议带着报告问你的主治医生。';

/**
 * IS THE REGENERATED ANSWER STILL AN ANSWER?
 *
 * Driven against the running stack, this is the failure the regeneration
 * introduces and it is worse than the violation it fixes. Told that
 * three of its sentences were out of bounds, the model deleted the whole
 * reply and returned 「你还有什么想了解的吗？」 — clean, compliant, and a
 * patient who asked about their own genetics report reading a
 * conversational filler. The directive now says not to; a directive is
 * not a control, which is the premise of this entire file.
 *
 * So the regeneration is ACCEPTED ONLY IF IT IS STILL SUBSTANTIVE, and
 * otherwise the run falls back to excising the FIRST answer — which
 * keeps this platform's readings, the retrieved material and the
 * citations the patient can open, loses exactly the offending sentences,
 * and says so. A stunted-but-clean reply and an excised-but-complete one
 * are both honest; only the second one answers the question.
 *
 * The threshold is a fraction of what excision alone would have left,
 * not of the original: comparing against the original would reject a
 * regeneration of an answer that was mostly violation, which is the case
 * where regenerating helps most.
 */
const SUBSTANTIVE_FRACTION = 0.5;

export const isSubstantiveRewrite = (rewrite: string, excisedOriginal: string): boolean =>
  rewrite.trim().length >= Math.floor(excisedOriginal.trim().length * SUBSTANTIVE_FRACTION);

/**
 * The short reason that stands where the sentence stood.
 *
 * ONE LINE, IN THE PLACE THE SENTENCE OCCUPIED, and this is the whole
 * point of marking rather than deleting. Deletion was tried first and
 * produced rubble: excising 「是的，你的报告里确实没有甲基化的结果——…」
 * and the sentence that introduced the list below it left a live answer
 * opening on four orphaned bullets and a closing recommendation, with no
 * lead-in and no subject. The patient could not tell that from a broken
 * renderer, and could not tell WHICH part had been judged. A marker in
 * place says both, keeps the document's structure intact, and cannot be
 * mistaken for the answer's own words.
 */
const REDACTION_MARK_ZH: Readonly<Record<ClinicalViolationKind, string>> = {
  severity_from_patient_number:
    '（这里有一句被我删掉了：它拿你自己的数值去推病情轻重或进展快慢，本平台不做这个判断。）',
  ungraded_cell_graded: '（这里有一句被我删掉了：它给一项本平台不下结论的指标划了高低。）',
  unsourced_mechanism: '（这里有一句被我删掉了：它给的机制解释在这次检索到的资料里查不到出处。）',
  retest_of_a_value_on_file:
    '（这里有一句被我删掉了：它把「按当前授权没发给我」说成了「你的报告里没有」。）',
};

/**
 * Replace the violating segments with the reason they went.
 *
 * A TABLE ROW IS REMOVED rather than marked: a row replaced by prose is
 * a broken table, and a table missing one row still renders. Everything
 * else is marked in place, so the paragraph it sat in keeps its shape.
 */
export const redactViolations = (
  answer: string,
  violations: readonly ClinicalViolation[],
): string => {
  const markFor = new Map<string, string>();
  for (const violation of violations) {
    if (!markFor.has(violation.sentence)) {
      markFor.set(violation.sentence, REDACTION_MARK_ZH[violation.kind]);
    }
  }
  const doomed = segmentsOf(answer).filter((segment) => markFor.has(segment.text.trim()));
  if (doomed.length === 0) return answer;
  let out = answer;
  // Right to left so earlier offsets stay valid.
  for (const segment of [...doomed].sort((a, b) => b.start - a.start)) {
    const replacement = segment.text.trim().startsWith('|')
      ? ''
      : (markFor.get(segment.text.trim()) ?? '');
    out = out.slice(0, segment.start) + replacement + out.slice(segment.end);
  }
  // A sentence removed from the MIDDLE of a line takes its half of the
  // surrounding markdown with it. Observed: excising
  // 「**报告中没有甲基化的结果。」 left a line opening 「** 」, which the
  // client renders as a stray asterisk pair. Nothing here rewrites
  // words — it only drops markup that no longer has a partner, and
  // lines that are now nothing but markup.
  const ORPHAN_BOLD = /\*\*/gu;
  return out
    .split('\n')
    .map((line) => {
      const bolds = line.match(ORPHAN_BOLD)?.length ?? 0;
      return bolds % 2 === 1 ? line.replace('**', '') : line;
    })
    .filter((line) => !/^[\s*_~`>|:-]+$/u.test(line) || line.trim() === '' || /\|/u.test(line))
    .filter((line, index, lines) => !(line.trim() === '' && lines[index - 1]?.trim() === ''))
    .join('\n')
    .trim();
};

/** What the guard did, carried onto the run result for the audit row. */
export interface ClinicalGuardState {
  violations: ClinicalViolation[];
  /** `localised` — nothing was wrong with the claims; a wire token was
   *  rewritten into Chinese on the way out. `regenerated` — the check
   *  fired and the second answer was clean. `excised` — it was not, and
   *  the sentences were marked and reported to the patient. */
  action: 'localised' | 'regenerated' | 'excised';
  /** Wire tokens rewritten into Chinese on the way out. */
  localisedTokens: string[];
}

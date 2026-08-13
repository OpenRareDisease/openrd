import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import {
  AMBULATION_VALUE_RENDERINGS,
  ambulationSentences,
  locatorsIn,
} from './__fixtures__/reason-claims.js';
import { normaliseSource } from './export-source.js';
import { buildTreatNmdExport } from './treat-nmd.js';

/**
 * The fixture `locatorsIn` is calibrated against.
 *
 * The helper exists so a reason cannot point a receiving hospital at a
 * section the document does not have. It was written once, tried only
 * on the three reasons that shipped that day, and made both the
 * brackets and the 一 of 「运动功能」一节 optional — which turned every
 * word ending in 节 into a document locator. 关节 is core FSHD
 * vocabulary (关节活动度 is a measurement this platform collects) and
 * this whole export module writes prose about orthoses, so the false
 * positive is not hypothetical: appending 「这些测量的细节见各条
 * Observation。」 to the live FHIR reason returned `['这些测量的细节']`
 * and reddened `expect(locatorsIn(reason)).toEqual([])`.
 *
 * A test author cannot fix that by editing the helper's callers — two
 * of the three assert an empty array and the third feeds every locator
 * back into the serialised document — so the only move left is bending
 * a patient-facing Chinese sentence around a regex. Hence both
 * directions pinned here, on sentences rather than on whichever three
 * reasons happen to ship:
 *
 *   - POINTERS is every shape the exports use to point INTO the
 *     document, with the exact locator each must yield.
 *   - NOT_POINTERS is prose these reasons legitimately contain that
 *     points at nothing: ordinary 节 words, and path-looking tokens
 *     with no dot.
 *
 * A widening that catches a new pointer shape has to leave NOT_POINTERS
 * empty, and a narrowing that silences a false positive has to leave
 * POINTERS resolving. Neither list is derivable from the other.
 */
describe('locatorsIn — a place in the document, not any word ending in 节', () => {
  /** [reason fragment, the locators it points at]. */
  const POINTERS: Array<[string, string[]]> = [
    // Verbatim from the shipped TREAT-NMD reason (treat-nmd.ts): the
    // dotted shape, two of them in one sentence.
    [
      '若患者在填写 Vignos 时选择了同步到基线，由分级推出的行走状态会出现在 sections.motorFunction 的 motor.ambulation 与 sections.wheelchairUse 的 wheelchair.currentState，分级本身仍然不在。',
      [
        'sections.motorFunction',
        'motor.ambulation',
        'sections.wheelchairUse',
        'wheelchair.currentState',
      ],
    ],
    // The bracketed named section, which is what the helper's own doc
    // comment cites.
    ['基线行走状态见「运动功能」一节。', ['运动功能']],
    ['轮椅相关信息在「轮椅使用」一节。', ['轮椅使用']],
    // The unbracketed named section: the round-one wording that this
    // module actually shipped. The name is bounded on the left by the
    // pointing particle, so the locator is 运动功能 and not the run of
    // prose in front of it.
    ['由分级推出的行走状态会出现在运动功能一节。', ['运动功能']],
    // A section name that is itself a 节 word must still resolve — the
    // narrowing is about the shape of the pointer, not about banning a
    // vocabulary.
    ['详见关节活动度一节。', ['关节活动度']],
  ];

  /** Prose that points nowhere. Every one of these is a sentence an
   *  FSHD export reason can reasonably contain. */
  const NOT_POINTERS = [
    // The one that reproduced as a red test on the live FHIR reason.
    '这些测量的细节见各条 Observation。',
    '本导出不含关节活动度数据。',
    '本导出不含评估关节活动度所需的数据。',
    '该数据集共有六个章节，本导出不编造章节数。',
    '手术麻醉只是围手术期管理中的一个环节。',
    '随访频率按季节和患者情况调整。',
    '这一节说明留在采集方本地的字段。',
    // Verbatim from the shipped Phenopacket and FHIR reasons.
    '本文件不含任何行走能力或运动功能数据。',
    '基线行走状态不在本 Bundle 中；需要它请向患者索取，或改用 TREAT-NMD 对齐导出。',
    // A path-looking token with no dot is not a place in this document.
    '分级本身请调用 /me/instruments 获取。',
    // Dotted ASCII that is not a path into this document. This half of
    // the list was empty while the dotted branch matched any dot-joined
    // run, so the narrowing that fixed it had nothing pinning the
    // direction it was narrowing: a version, a URL, an address, a
    // filename and an abbreviation all came back as places to look.
    '本 Bundle 依据 FHIR R4.0.1 规范生成。',
    '本导出遵循 v2.5.0 的字段定义。',
    '完整规范见 https://hl7.org/fhir/R4/。',
    '如需帮助请联系 support@openrd.cn。',
    '导出格式的定义见 treat-nmd.ts。',
    '各字段的中文名见 export/labels.ts。',
    '量表版本、施测时间 e.g. 这类字段一律不写入。',
    // Dotted runs whose FRAGMENTS used to come back as locators,
    // because `.` was in the lookbehind and not in the lookahead: the
    // expression returned the longest prefix that satisfied the other
    // rules rather than nothing at all.
    '本 Bundle 依据 HL7.FHIR.R4 规范生成。',
    '字段映射参照 org.hl7.fhir.r4.model.Bundle。',
    '相关用例见 export_labels.test.ts。',
  ];

  it.each(POINTERS)('points at something: %s', (reason, expected) => {
    expect(locatorsIn(reason)).toEqual(expected);
  });

  it.each(NOT_POINTERS)('points at nothing: %s', (reason) => {
    expect(locatorsIn(reason)).toEqual([]);
  });

  /**
   * The residue, pinned rather than promised — and pinned as a SET, so
   * that a widening cannot quietly enlarge it.
   *
   * The version of this test that shipped asserted two inputs came back
   * as locators and claimed in its comment that this made 「a future
   * widening come here first」. It could not: it stayed green under the
   * maximally-wide regex this file was written to narrow, while seven
   * sibling cases went red. An assertion that only says 「these two are
   * still matched」 is satisfied by every widening there is.
   *
   * So both halves are here. Anything with the shape rules 2 and 3
   * describe — identifier segments, three or more characters each, at a
   * token boundary — is returned whatever it actually is, because
   * nothing in its shape tells it from `motor.ambulation`. An author
   * who hits one writes the scheme or the directory instead, and that
   * fix is the first NOT_POINTERS entry for each.
   */
  it('still reads any dot-joined run of identifier segments as a locator', () => {
    expect(locatorsIn('完整规范见 hl7.org。')).toEqual(['hl7.org']);
    expect(locatorsIn('各字段的中文名见 labels.json。')).toEqual(['labels.json']);
    // Not only the two named above: the class is wider than a host and
    // a filename, and saying so is the difference between a documented
    // limit and a limit somebody happened to give two examples of.
    expect(locatorsIn('见 docs.openrd.org 与 bundle.fields.json。')).toEqual([
      'docs.openrd.org',
      'bundle.fields.json',
    ]);
    expect(locatorsIn('打包为 openrd.api.exporter，版本 rev.alpha.beta。')).toEqual([
      'openrd.api.exporter',
      'rev.alpha.beta',
    ]);
    expect(locatorsIn('分级字段名为 Vignos.Grade。')).toEqual(['Vignos.Grade']);
  });

  /**
   * The other direction of the same rule, and the one that was written
   * down nowhere.
   *
   * Rule 3 — every segment at least three characters — makes a real
   * pointer with a short segment invisible. Not truncated to a shorter
   * pointer that happens to resolve, which is what the missing `.` in
   * the lookahead used to do; absent. `subject.id` already ships as
   * literal Chinese in the Phenopacket reason and `OntologyClass.id` in
   * codings.ts, so this is not hypothetical: a reason may point at a
   * `q1` item that does not exist and treat-nmd.test.ts's forward check
   * — which only ever sees what this function returns — will not say so.
   *
   * Loosening rule 3 re-admits `labels.ts`, `openrd.cn` and `e.g.`,
   * every one of them a NOT_POINTERS entry above. That is the trade;
   * this test is what makes anyone who changes it face the trade.
   */
  it('does not see a dotted pointer with a segment under three characters', () => {
    expect(locatorsIn('见本文件的 subject.id 与 Bundle.id。')).toEqual([]);
    expect(locatorsIn('详见 OntologyClass.id。')).toEqual([]);
    // And the one that used to be worse than invisible: before `.` was
    // added to the trailing lookahead this came back as
    // `['sections.motorFunction']`, a locator that resolves, so the
    // forward check confirmed a pointer whose last segment is imaginary.
    expect(locatorsIn('取值见 sections.motorFunction.q1。')).toEqual([]);
    expect(locatorsIn('取值见 sections.motorFunction.qqq。')).toEqual([
      'sections.motorFunction.qqq',
    ]);
  });
});

/**
 * The other half of the fixture: the subject side of
 * `ambulationSentences`.
 *
 * The list this calibrates used to be four whole words, chosen by
 * reading the reasons that shipped that day, under a comment claiming
 * it held 「every spelling anyone could reasonably reach for」. It did
 * not hold a single one of the spellings the exports themselves render
 * the value in, so 「基线里的运动功能状态也会写入本 Bundle。」 appended
 * to the live FHIR reason left the export suite green.
 *
 * The fix for that was a hand-written list of the names, checked with
 * `toContain(name)` against the whole source file — which is not the
 * same as checking the SHIPPED name. 运动功能 occurs six times in
 * treat-nmd.ts and only one of them is the section's `titleZh`, so
 * renaming that one to 运动机能 left this test green and let 「基线里的
 * 运动机能状态也会写入本 Bundle。」 ship with only the golden moving.
 * The same list also simply missed `motorFunction`, the key of the very
 * section it was describing.
 *
 * So the names are not written down here at all. They are read off the
 * BUILT TREAT-NMD document — the only one of the three formats that
 * carries this value — by walking to the items whose keys the shipped
 * reason points at, and taking the section key, the section title, the
 * item key and the item label of each. Rename any of them in
 * treat-nmd.ts and the built document changes, so this test fails HERE,
 * before a claim written in the new name can ship.
 */
describe('ambulationSentences — the value under every name the exports give it', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sourceOf = (file: string): string => fs.readFileSync(path.join(here, file), 'utf8');

  const treatNmd = buildTreatNmdExport(
    normaliseSource(EXPORT_FIXTURE_PROFILE, {
      includeLocalOnly: false,
      generatedAt: FIXTURE_GENERATED_AT,
    }),
  ).document;

  /**
   * The item keys the shipped TREAT-NMD reason sends a reader to for
   * this value. Named here because they are what makes an item THE
   * walking state rather than a neighbouring one; everything else is
   * derived from them.
   */
  const AMBULATION_ITEM_KEYS = ['motor.ambulation', 'wheelchair.currentState'];

  const carriers = AMBULATION_ITEM_KEYS.map((itemKey) => {
    const section = treatNmd.sections.find((entry) =>
      entry.items.some((item) => item.key === itemKey),
    );
    expect(section, `no TREAT-NMD section carries ${itemKey}`).toBeDefined();
    return { section: section!, item: section!.items.find((entry) => entry.key === itemKey)! };
  });

  /** Section key, section title and item key — each a name for this
   *  value on its own. */
  const DOCUMENT_NAMES = carriers.flatMap(({ section, item }) => [
    section.key,
    section.titleZh,
    item.key,
  ]);

  /**
   * Item labels, qualified by their section. An item label is NOT a
   * name for this value on its own — the wheelchair item's label is
   * 当前状态, and 「基线里的当前状态」 names nothing in particular — so
   * the name a reason would have to use is the label inside its
   * section. Pinned in that form rather than dropped, and the bare
   * form is pinned below as a known miss.
   */
  const QUALIFIED_ITEM_LABELS = carriers.map(
    ({ section, item }) => `「${section.titleZh}」一节的${item.labelZh}`,
  );

  /**
   * The names that live outside the TREAT-NMD document: the normalised
   * source field, pinned to the exact line that writes it rather than
   * to any occurrence of the word.
   */
  const SOURCE_NAMES: Array<[string, string, string]> = [
    ['independentlyAmbulatory', 'export-source.ts', 'text(status?.independentlyAmbulatory)'],
    ['ambulation', 'export-source.ts', 'ambulation: text(status?.independentlyAmbulatory)'],
    // The word the shipped FHIR sentence uses for the thing all those
    // Observations are about.
    ['走路', 'fhir-r4.ts', '本 Bundle 里凡是与走路有关的 Observation'],
  ];

  it('reads its names off the built document, and finds them all', () => {
    // A derivation that silently returned nothing would pass every test
    // below for the wrong reason.
    expect(DOCUMENT_NAMES).toEqual([
      'motorFunction',
      '运动功能',
      'motor.ambulation',
      'wheelchairUse',
      '轮椅使用',
      'wheelchair.currentState',
    ]);
    expect(QUALIFIED_ITEM_LABELS).toEqual([
      '「运动功能」一节的当前行走能力',
      '「轮椅使用」一节的当前状态',
    ]);
  });

  it.each(QUALIFIED_ITEM_LABELS)('sees the value under its item label in place: %s', (name) => {
    expect(ambulationSentences(`基线里${name}也会写入本 Bundle。`), name).toHaveLength(1);
  });

  /**
   * The bound this derivation runs into, pinned rather than papered
   * over: an item label lifted out of its section is not a name for
   * this value and is not in the class. A reason that wrote 「基线里的
   * 当前状态也会写入本 Bundle。」 would be making the claim in words no
   * receiver could resolve either, which is why the answer here is to
   * record the miss rather than to widen the pattern to 当前状态.
   */
  it('does not see an item label lifted out of its section', () => {
    const bare = carriers.map(({ item }) => item.labelZh);
    expect(bare).toContain('当前状态');
    expect(ambulationSentences('基线里的当前状态也会写入本 Bundle。')).toEqual([]);
  });

  it.each(AMBULATION_VALUE_RENDERINGS)('sees the value as labels.ts renders it: %s', (label) => {
    expect(ambulationSentences(`基线里「${label}」这一项也会写入本 Bundle。`)).toHaveLength(1);
  });

  it.each(DOCUMENT_NAMES)('sees the value under the name the document gives it: %s', (name) => {
    expect(ambulationSentences(`基线里的${name}也会写入本 Bundle。`), name).toHaveLength(1);
  });

  it.each(SOURCE_NAMES)(
    'sees the value under the name %s, which %s still writes',
    (name, file, shippedOccurrence) => {
      // The exact occurrence, not any occurrence: `ambulation` appears
      // six times in export-source.ts and 运动功能 six times in
      // treat-nmd.ts, so a `toContain(name)` on the whole file is
      // satisfied by a comment that mentions the word.
      expect(sourceOf(file), `${name} is no longer written at this site in ${file}`).toContain(
        shippedOccurrence,
      );
      expect(shippedOccurrence, `${shippedOccurrence} does not contain ${name}`).toContain(name);
      expect(ambulationSentences(`基线里的${name}也会写入本 Bundle。`), name).toHaveLength(1);
    },
  );

  /**
   * The two shapes that shipped green: a claim about this document with
   * no demonstrative in it, and a claim in the shipped code's own words
   * rather than the reason's. Both are returned now, and the caller
   * enumerates.
   */
  it.each([
    '基线行走状态会作为 Observation 一并导出',
    '基线里的运动功能状态也会写入本 Bundle',
    '患者能否独立行走的答案会写入本 Bundle',
    '基线里「可独立行走」这一项也会作为 Observation 写入本文件',
    '本 Bundle 会写入 independentlyAmbulatory 的取值',
    '基线轮椅使用状态一并导出',
  ])('sees the claim that shipped green: %s', (sentence) => {
    expect(ambulationSentences(`${sentence}。`)).toEqual([sentence]);
  });

  /**
   * The ordinary synonyms. Not names any file here writes — that is
   * the point: the shipped vocabulary is derived above, and this is the
   * half a maintainer or a clinician reaches for instead. Every one of
   * these slipped the four-word list AND the six-name list that
   * replaced it, with only the golden moving.
   */
  it.each([
    '基线里的行动能力也会写入本 Bundle',
    '基线里的运动能力也会写入本 Bundle',
    '本 Bundle 会写入患者的 walking status',
    '基线里「需要拐杖或支具」这一项也会一并导出',
    '基线里的下肢功能状态也会写入本 Bundle',
    '患者能否自主移动会作为 Observation 写入本文件',
    '患者能不能自己下地会写入本 Bundle',
    '基线里的代步工具情况也会一并导出',
    '由 Vignos 分级推出的取值也会写入本 Bundle',
    '本 Bundle 的 motorFunction 一节会写入基线取值',
  ])('sees the claim in an ordinary synonym: %s', (sentence) => {
    expect(ambulationSentences(`${sentence}。`)).toEqual([sentence]);
  });

  /**
   * THE BOUND, pinned so it stays a measurement.
   *
   * A claim that names the value without using any word on the list is
   * not in the class, and widening the list one more time does not
   * change that — it only moves where the line is. These two are the
   * shape an author would have to write to make the claim invisible
   * today: a periphrasis, in ordinary Chinese, with no walking word in
   * it at all. If a future widening catches them, it has to replace
   * them here with the next two, so the file never claims coverage it
   * does not have.
   */
  it.each([
    '患者能不能自己上下楼，本 Bundle 里也有',
    '基线里的离床情况会作为 Observation 一并写出',
  ])('does not see a claim written around every word on the list: %s', (sentence) => {
    expect(ambulationSentences(`${sentence}。`)).toEqual([]);
  });

  /** A reason sentence about something else is still not in the class. */
  it.each([
    '本导出不含关节活动度数据',
    '本次导出持有 3 条肌力记录与 2 条功能测试记录',
    'D4Z4 重复数与单倍型在 TREAT-NMD 对齐导出中按其本来面目呈现',
  ])('leaves a sentence about something else out: %s', (sentence) => {
    expect(ambulationSentences(`${sentence}。`)).toEqual([]);
  });
});

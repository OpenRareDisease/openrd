/**
 * Reading an omission reason the way its receiver does.
 *
 * The 「where is the walking state」 sentence has now been wrong twice,
 * and both times a test was watching the wrong thing. The first guard
 * was `toContain('会出现在运动功能一节')`; when that sentence moved, the
 * replacement guard was `not.toMatch(/会出现在[^。]*一?节/)`. Both pin a
 * PHRASE, so both stay green while a new sentence in different words
 * makes the same false claim — verified: appending 「…行走状态会作为
 * Observation 写入本 Bundle。」 to the FHIR reason left the whole file
 * green, and only the golden moved.
 *
 * So the helpers here reduce the reason to the two things a receiver
 * acts on. A caller still names wording, but it names a CLOSED SET of
 * it — which is the part the old guards did not have, and the reason a
 * paragraph could grow a fourth sentence around them:
 *
 *   - `ambulationSentences` — every 。-delimited sentence that names the
 *     baseline walking state IN ONE OF THE WORDS AMBULATION_SUBJECT
 *     holds. Not 「every sentence that says anything about the walking
 *     state」, which is what this line used to claim and what no phrase
 *     test can do; the bound is stated at the pattern itself. Each
 *     caller lists the ones its format is allowed to have, BY EXACT
 *     STRING, so a new one has to be approved by a human before the
 *     suite goes green again.
 *   - `locatorsIn` — every place in the document the prose points at,
 *     in the two shapes these exports write. A format with no sections
 *     must name none; a format with sections must name only ones that
 *     resolve, and all of the ones that carry the state. What it does
 *     and does not read as a pointer is enumerated at DOTTED_LOCATOR
 *     and NAMED_SECTION, in both directions.
 *
 * BY EXACT STRING is load-bearing and was learned twice. Both callers
 * used `expect.stringContaining(...)` on each enumerated entry, which
 * turns every already-approved sentence into a safe harbour: append
 * 「，基线行走状态也会随本次导出一并写出」 as a clause of the shared
 * instrument prefix, or 「；不过基线里能不能独立行走这一项，本 Bundle 仍
 * 会作为 Observation 一并写入」 to the last FHIR sentence, and the array
 * is the same length, every matcher is still satisfied, and only the
 * golden moves. `sentencesOf` splits on 。 and nothing else — a clause
 * is not a sentence here — so the clause has to be caught by the
 * caller's assertion or not at all.
 *
 * The two are calibrated differently, and「over-broad on both sides」was
 * the mistake that put 关节 in a locator list. `ambulationSentences` IS
 * deliberately over-broad, because it has somewhere to put a false
 * positive: both callers spell out the sentences their format is
 * allowed to have, and one more line there is a human approving one
 * more sentence. `locatorsIn` has no such place. fhir-r4.test.ts and
 * phenopacket.test.ts assert `toEqual([])`, so a line added to those is
 * a recorded falsehood under a comment reading「no pointer into a
 * document that has no sections」, and treat-nmd.test.ts feeds every
 * locator back into the serialised document, where a Chinese false
 * positive can only fail. So `locatorsIn` returns pointers that are
 * shaped like pointers, and the shapes it does not catch are named at
 * the expression itself.
 *
 * WHY THERE IS NO 「does it negate」 TEST HERE. There was one: a
 * sentence was exempted when it contained 不/未/没有/无/非 anywhere. It
 * exempted the wrong sentences, because these reasons are written in
 * clauses and the negation does not have to sit in the clause that
 * makes the claim — 「基线行走状态没有单独的资源类型，但会作为
 * Observation 写入本 Bundle。」 negates in its first clause, asserts the
 * false thing in its second, and sailed straight through. Scoping the
 * negation to a clause does not rescue it either: the shipped FHIR
 * sentence denies presence in a clause with no negation token at all
 * (「把其中任何一项读作基线行走状态都会读错」), so any clause rule tight
 * enough to catch the first is loose enough to reject the second.
 * Reading denial out of Chinese prose is the thing this file is not
 * able to do, so it does not claim to. It returns the whole class and
 * makes the caller enumerate.
 *
 * WHY THERE IS NO 「is it about THIS document」 TEST HERE EITHER. There
 * was one, and it was the same species of mistake as the two guards
 * this file replaced. `SELF_REFERENCE` required a demonstrative in
 * front of a container noun (本 Bundle / 该文件 / 此次导出), on the
 * stated ground that 「a sentence about the walking state that names
 * none of these is talking about somewhere else」. It is not:
 * 「基线行走状态会作为 Observation 一并导出。」 is about this document,
 * names no demonstrative, and was dropped from the class — appended to
 * the live FHIR reason it left every export test green and moved only
 * the golden, which is the exact signature the two earlier guards
 * failed with. A phrase test cannot enumerate the ways Chinese refers
 * to the document it is written in, so the axis is gone: a sentence in
 * the class is returned whether or not it is about this document,
 * including the 「改用 TREAT-NMD 对齐导出」 redirect that points away
 * from here, and the caller enumerates that one too. A few extra
 * approved lines per format is the price of not having a third phrase
 * guard.
 *
 * WHAT IS STILL A PHRASE TEST, and therefore still has a bound: which
 * sentences enter the class at all. That is AMBULATION_SUBJECT, its
 * bound is stated there, and it is calibrated in reason-claims.test.ts
 * against names read off the built TREAT-NMD document rather than off
 * a list somebody thought of.
 */

import { AMBULATION_LABELS } from '../labels.js';

/**
 * The subject of the claim, in EVERY spelling — not the spellings
 * these reasons happen to use today.
 *
 * The list this replaces held four whole words (行走状态, 行走能力,
 * 步行能力, ambulation) and was justified by 「every spelling anyone
 * could reasonably reach for」, while omitting the spellings the
 * SHIPPED CODE writes for the same value: labels.ts renders it as
 * 可独立行走… / 需要辅助…才能行走 / 无法行走…, the normalised source
 * field is `independentlyAmbulatory`, and both the section that
 * carries `motor.ambulation` and the Phenopacket reason call it
 * 运动功能. A claim in any of those slipped the class entirely.
 *
 * So this is fragments, not whole words, and reason-claims.test.ts
 * checks it against the strings the exports actually render — if
 * labels.ts grows a label this does not match, that test fails here
 * rather than a claim shipping unseen. 轮椅 is in because TREAT-NMD
 * stores this same value under `wheelchair.currentState`, so a
 * sentence about the baseline wheelchair state is a sentence about
 * this value under another name. 走路 is in for the same reason and
 * was missing for the same reason: the shipped FHIR sentence writes
 * 「本 Bundle 里凡是与走路有关的 Observation」, so it was already the
 * document's own word for this and still fell outside the class.
 * `motor` is in because the section KEY is `motorFunction` and the
 * item key is `motor.ambulation` — the second version of this list
 * covered the section's title and missed its key, which a reason
 * naming 「本 Bundle 的 motorFunction 一节」 walks straight through.
 * Vignos and 下肢 are in because the walking state in these documents
 * is derived from the Vignos lower-limb grade, so a sentence about
 * that grade reaching the export is a sentence about this value.
 *
 * THE BOUND, since the earlier version of this comment claimed there
 * was none: a claim written in a word this pattern does not hold is
 * not in the class, and no amount of adding words makes that stop
 * being true. Named precisely, because 「every spelling anyone could
 * reasonably reach for」 is what the four-word list this replaced said
 * about itself:
 *
 *   - the names the DOCUMENT gives this value are covered and STAY
 *     covered, because reason-claims.test.ts reads them off the built
 *     TREAT-NMD document — section key, section title and item key for
 *     each branch carrying the state — rather than off a list. Rename
 *     one in treat-nmd.ts and that test fails HERE, before a claim in
 *     the new name can ship. The same test pins the labels labels.ts
 *     renders and the field export-source.ts normalises, each against
 *     the exact line that writes it;
 *   - an item LABEL is not covered on its own, because one of them is
 *     当前状态 and that is a name for nothing outside its section. The
 *     covered form is the label inside its section title, and the bare
 *     form is pinned as a known miss;
 *   - the ordinary Chinese and English synonyms are hand-listed and
 *     hand-listed is all they can be. 行动/移动/代步/下地/拐杖/支具/下肢/
 *     轮椅/步态/活动能力/运动能力/walk/gait cover what a maintainer or a
 *     clinician is likely to write; a periphrasis that avoids every one
 *     of them — 「患者能不能自己上下楼」, 「离床情况」 — is not in the class
 *     and nothing here will notice it. reason-claims.test.ts pins two
 *     such sentences as known misses so the boundary is a measurement
 *     rather than a shrug.
 */
const AMBULATION_SUBJECT =
  /行走|步行|走路|行动|移动|代步|下地|下肢|拐杖|支具|运动功能|运动能力|轮椅|步态|活动能力|ambulat|wheelchair|gait|walk|motor|Vignos/i;

/**
 * 。 and nothing else. A clause joined on ；or ，is part of the
 * sentence it hangs off, which is why the callers assert the entries
 * of this list by exact string rather than by substring — see the
 * header. Splitting on clause marks instead was the other option and
 * was not taken: it fragments 「「10 米步行计时」「6 分钟步行距离」…是某一天
 * 的一次计时」 into pieces no receiver reads as a unit, and the caller
 * would be enumerating fragments rather than the sentences a hospital
 * actually gets.
 */
const sentencesOf = (reasonZh: string): string[] =>
  reasonZh
    .split('。')
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/**
 * Every sentence that names the baseline walking state in one of
 * AMBULATION_SUBJECT's words — the denials and the redirects as well as
 * the claims.
 *
 * The caller asserts the exact list, string for string, so a format
 * that grows a new such sentence OR edits an approved one turns red
 * whatever the change says, and a human decides whether it is true.
 * 「it is in here somewhere」 is the sentence that stops a receiver
 * asking the patient, and it has been shipped twice.
 */
export const ambulationSentences = (reasonZh: string): string[] =>
  sentencesOf(reasonZh).filter((sentence) => AMBULATION_SUBJECT.test(sentence));

/** Exported for the calibration test: the value's shipped renderings. */
export const AMBULATION_VALUE_RENDERINGS = Object.values(AMBULATION_LABELS);

/**
 * What a named Chinese section pointer looks like.
 *
 * 节 by itself is not a section. 关节 is core FSHD vocabulary — 关节活动
 * 度 is a thing this platform measures — and 细节, 章节, 环节, 季节 are
 * ordinary words a receiver-facing reason may reach for at any time. The
 * first version of this expression made both the brackets and the 一
 * optional, so any 2-8 CJK characters sitting in front of a 节 came back
 * as a place inside the document: dropping 「这些测量的细节见各条
 * Observation。」 into the shipped FHIR reason returned
 * `['这些测量的细节']` and reddened `expect(locatorsIn(reason))
 * .toEqual([])` — a guard against pointing at a section that does not
 * exist, failing a sentence that points at nothing at all.
 *
 * So a pointer has to be shaped like one, in the two ways these exports
 * write it:
 *
 *   1. bracketed —「运动功能」一节, where the brackets bound the name;
 *   2. after a pointing particle — 见/在/于/到/至 + name + 一节, which is
 *      how the round-one TREAT-NMD wording shipped it (「…会出现在运动功
 *      能一节」). The particle is what bounds the name on the left; with
 *      no left bound the greedy run ate the prose in front of it and
 *      returned 「会出现在运动功能一节」, which resolves against no
 *      document either.
 *
 * In the unbracketed form the 一 is required, and it is the whole
 * difference between 运动功能一节 and 关节.
 *
 * Two shapes it does NOT catch, both stated rather than hidden: a
 * numbered section (「见第一节」) and a name longer than twelve
 * characters. No export writes either today, and a bounded false
 * negative is the price of not making an author reword 关节活动度 around
 * a test regex.
 */
const NAMED_SECTION = /「([^「」\n]{2,12})」[ 　]*一?节|[见在于到至][ 　]*([一-鿿]{2,8})一节/g;

/**
 * A dotted path INTO this document — `sections.motorFunction`,
 * `motor.ambulation`, `codingProvenance.emitted`.
 *
 * The first version was `[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+`,
 * i.e. any dot-joined ASCII run, and dotted ASCII is house style in
 * these Chinese reasons for things that are NOT places in the document:
 * 「本 Bundle 依据 FHIR R4.0.1 规范生成。」 came back as `['R4.0.1']`,
 * 「完整规范见 https://hl7.org/fhir/R4/。」 as `['hl7.org']`,
 * 「导出格式的定义见 treat-nmd.ts。」 as `['nmd.ts']` and
 * 「如需帮助请联系 support@openrd.cn。」 as `['openrd.cn']`. Every one
 * of those reddens a caller asserting `toEqual([])`, and the author's
 * only exits are to bend a receiver-facing Chinese sentence around this
 * regex or to delete the assertion — the choice reason-claims.test.ts
 * exists to prevent.
 *
 * Three requirements, each one a thing a locator is rather than a
 * shape a false positive happens to have:
 *
 *   1. It starts and ends at a token boundary — and `.` is on BOTH
 *      sides of that boundary. The first narrowing put `.` in the
 *      lookbehind and left it out of the lookahead, so the rule held
 *      only on the left and the expression returned the longest
 *      PREFIX that satisfied the other two rules: `HL7.FHIR.R4` came
 *      back as `HL7.FHIR`, `org.hl7.fhir.r4.model.Bundle` as
 *      `org.hl7.fhir`, `export_labels.test.ts` as
 *      `export_labels.test`. A fragment is not a path, and a fragment
 *      of a path is worse than nothing — `sections.motorFunction.q1`
 *      truncated to `sections.motorFunction`, which resolves, so
 *      treat-nmd.test.ts confirmed a pointer whose last segment does
 *      not exist.
 *   2. Every segment is an identifier — a letter or `_` first. A
 *      version (`R4.0.1`, `v2.5.0`) has numeric segments; a document
 *      key never does.
 *   3. Every segment is at least three characters. This is what
 *      separates a key path from `e.g.`, `i.e.` and from the file
 *      extensions and country TLDs (`labels.ts`, `openrd.cn`) that end
 *      the short-suffix half of the false positives.
 *
 * WHAT IT STILL READS AS A LOCATOR AND SHOULD NOT. Rules 2 and 3
 * describe `motor.ambulation` exactly, and they describe every other
 * dot-joined run of three-or-more-character identifier segments just
 * as exactly. So: bare hosts (`hl7.org`, `docs.openrd.org`), bare
 * filenames (`labels.json`, `bundle.fields.json`, `README.rst`),
 * package and module names (`openrd.api.exporter`, `rev.alpha.beta`)
 * and `Type.Member` spellings (`Vignos.Grade`). Nothing in their shape
 * tells them apart, and there is no caller that can absorb them, so
 * the author's fix is to write the scheme (`https://hl7.org/fhir`) or
 * the directory (`export/labels.json`) — rule 1 then drops it — or to
 * name the thing in Chinese. The first NOT_POINTERS entry for each is
 * that fix.
 *
 * WHAT IT DOES NOT READ AS A LOCATOR AND SHOULD. Rule 3 is a real
 * false negative and it was stated nowhere: a dotted path with ANY
 * segment shorter than three characters is not returned — not
 * truncated, not partially matched, absent. `subject.id` (shipped in
 * the Phenopacket reason), `Bundle.id`, `OntologyClass.id` and
 * `sections.motorFunction.q1` are all invisible here, so a reason may
 * point a receiver at a `q1` item that does not exist and no caller
 * will say so. Both directions are pinned in reason-claims.test.ts;
 * loosening rule 3 to rescue them re-admits `labels.ts`, `openrd.cn`
 * and `e.g.`, which is the trade this expression is choosing and the
 * reason the choice is written down.
 */
const DOTTED_LOCATOR =
  /(?<![A-Za-z0-9_./@-])[A-Za-z_][A-Za-z0-9_]{2,}(?:\.[A-Za-z_][A-Za-z0-9_]{2,})+(?![A-Za-z0-9_/@.-])/g;

/**
 * Every place inside the document the reason points at.
 *
 * Two shapes, because those are the two the exports use: a dotted
 * locator (`sections.motorFunction`, `wheelchair.currentState`), and a
 * named Chinese section (「运动功能」一节). A path-looking token with no
 * dot — `/me/instruments`, `TREAT-NMD` — is not a place in this
 * document and is not returned. Each expression states what it reads
 * that it should not AND what it does not read that it should; neither
 * list is 「the shapes we have not got round to」.
 *
 * A named section is returned as the NAME (运动功能), not as the phrase
 * that carried it, because that is the string a caller can resolve: the
 * TREAT-NMD test searches a non-dotted locator in the serialised
 * document, where the name appears as a section's `titleZh` and
 * 「运动功能」一节 appears nowhere.
 */
export const locatorsIn = (reasonZh: string): string[] => {
  const dotted = reasonZh.match(DOTTED_LOCATOR) ?? [];
  const namedSections = [...reasonZh.matchAll(NAMED_SECTION)].map((match) => match[1] ?? match[2]);
  return [...dotted, ...namedSections];
};

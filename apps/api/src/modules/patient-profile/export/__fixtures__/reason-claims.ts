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
 *   - `documentScopedAmbulationSentences` — every sentence that says
 *     something about the baseline walking state AND about THIS
 *     document. Each caller lists the ones its format is allowed to
 *     have, so a new one has to be approved by a human before the
 *     suite goes green again.
 *   - `locatorsIn` — every place in the document the prose points at.
 *     A format with no sections must name none; a format with sections
 *     must name only ones that resolve, and all of the ones that carry
 *     the state.
 *
 * Deliberately over-broad on both sides: a false positive costs a test
 * author one line in a known-good list, a false negative costs a
 * receiving hospital a pointer into a document that does not have what
 * it says it has.
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
 */

/**
 * The subject of the claim, in EVERY spelling these reasons use.
 *
 * 行走状态 is what the FHIR sentence writes today —「行走状态（ambulation）」
 * — and listing only that was a hole, not a simplification: 行走能力 is
 * the label the shipped TREAT-NMD document gives the same value
 * (treat-nmd.ts, 「当前行走能力」), it is how the round-one FHIR wording
 * named it, and it opens the shipped Phenopacket reason. A claim
 * written in the spelling three of the four surfaces already use was
 * simply not in the class, and shipped green.
 *
 * So the rule for this list is not 「the spellings we use」 but 「every
 * spelling anyone could reasonably reach for」. 步行能力 is here for
 * that reason and is used nowhere yet.
 */
const AMBULATION_SUBJECTS = ['行走状态', '行走能力', '步行能力', 'ambulation'];

/**
 * Ways a reason refers to the document it is attached to. A sentence
 * about the walking state that names none of these is talking about
 * somewhere else — 「需要基线行走状态请向患者索取，或改用 TREAT-NMD 对齐
 * 导出」 is not about this document, and must not be pulled in.
 *
 * Written as a demonstrative plus a container noun rather than as a
 * list of whole phrases, so 「这份文件」/「该 Bundle」/「此次导出」 cannot
 * arrive as a new spelling that nothing matches. The demonstrative is
 * required: bare 「导出」 would swallow the 「改用 TREAT-NMD 对齐导出」
 * clause above, which points AWAY from this document.
 */
const SELF_REFERENCE =
  /[本这该此][ 　]*[次份个张篇]?[ 　]*(?:Bundle|Packet|Phenopacket|文件|文档|导出|记录|节|包)|sections\.|一节/;

const sentencesOf = (reasonZh: string): string[] =>
  reasonZh
    .split('。')
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

/**
 * Every sentence that puts the baseline walking state and this
 * document in the same breath — the denials as well as the claims.
 *
 * The caller asserts the exact list, so a format that grows a new such
 * sentence turns red whatever the sentence says, and a human decides
 * whether it is true. 「it is in here somewhere」 is the sentence that
 * stops a receiver asking the patient, and it has been shipped twice.
 */
export const documentScopedAmbulationSentences = (reasonZh: string): string[] =>
  sentencesOf(reasonZh).filter(
    (sentence) =>
      AMBULATION_SUBJECTS.some((token) => sentence.includes(token)) &&
      SELF_REFERENCE.test(sentence),
  );

/**
 * Every place inside the document the reason points at.
 *
 * Two shapes, because those are the two the exports use: a dotted
 * locator (`sections.motorFunction`, `wheelchair.currentState`), and a
 * named Chinese section (「运动功能一节」). A path-looking token with no
 * dot — `/me/instruments`, `TREAT-NMD` — is not a place in this
 * document and is not returned.
 */
export const locatorsIn = (reasonZh: string): string[] => {
  const dotted = reasonZh.match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/g) ?? [];
  const namedSections = [...reasonZh.matchAll(/「?([一-鿿]{2,8})」?一?节/g)].map(
    (match) => match[0],
  );
  return [...dotted, ...namedSections];
};

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
 * The two are calibrated differently, and「over-broad on both sides」was
 * the mistake that put 关节 in a locator list. `documentScopedAmbulation
 * Sentences` IS deliberately over-broad, because it has somewhere to put
 * a false positive: both callers spell out the sentences their format is
 * allowed to have, and one more line there is a human approving one more
 * sentence. `locatorsIn` has no such place. fhir-r4.test.ts and
 * phenopacket.test.ts assert `toEqual([])`, so a line added to those is a
 * recorded falsehood under a comment reading「no pointer into a document
 * that has no sections」, and treat-nmd.test.ts feeds every locator back
 * into the serialised document, where a Chinese false positive can only
 * fail. So `locatorsIn` returns pointers that are shaped like pointers,
 * and the shapes it does not catch are named at the expression itself.
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
 * Every place inside the document the reason points at.
 *
 * Two shapes, because those are the two the exports use: a dotted
 * locator (`sections.motorFunction`, `wheelchair.currentState`), and a
 * named Chinese section (「运动功能」一节). A path-looking token with no
 * dot — `/me/instruments`, `TREAT-NMD` — is not a place in this
 * document and is not returned.
 *
 * A named section is returned as the NAME (运动功能), not as the phrase
 * that carried it, because that is the string a caller can resolve: the
 * TREAT-NMD test searches a non-dotted locator in the serialised
 * document, where the name appears as a section's `titleZh` and
 * 「运动功能」一节 appears nowhere.
 */
export const locatorsIn = (reasonZh: string): string[] => {
  const dotted = reasonZh.match(/[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/g) ?? [];
  const namedSections = [...reasonZh.matchAll(NAMED_SECTION)].map((match) => match[1] ?? match[2]);
  return [...dotted, ...namedSections];
};

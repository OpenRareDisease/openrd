/**
 * 我想问的问题 — the sheet a patient fills in before a 协作网 visit.
 *
 * WHY THIS LIST IS DUPLICATED AND NOT IMPORTED
 * --------------------------------------------
 * The same list exists on the server as `REFERRAL_QUESTION_PROMPTS` in
 * `apps/api/src/modules/patient-profile/referral-pack.ts`, where it is
 * rendered into the printable 转诊包 alongside the patient's own
 * records. Both copies now reach a patient, and on the same screen:
 * `GET /profiles/me/referral-pack` ships, and p-referral renders the
 * server's list inside `pack.markdown` directly above this one.
 *
 * It is still duplicated, not shared, for two reasons that are not
 * temporary:
 *
 *  1. The mobile package cannot import from the API package.
 *  2. The server's copy only reaches someone who is signed in, has a
 *     profile, has signal, and has tapped 生成. This list is the half
 *     that works without any of that — see 「WHY THE 转诊资料 IS NOT
 *     FETCHED ON MOUNT」 in the screen: a hospital's dead wifi and a
 *     patient with no account are the ordinary case here, and the
 *     questions are why most people open the page.
 *
 * So the two must be kept in step by hand, and
 * `__tests__/question-sheet-parity.test.ts` reads the API source and
 * fails if a shared `id` grows a different `prompt` or `source` —
 * because the drift is not a comment's job to prevent.
 *
 * Two divergences are deliberate and are excluded from that check:
 *
 *  - `hint`. The server's hints cross-reference the pack document
 *    (「本资料第五节列了本平台掌握的三项监测记录」), which does not
 *    exist on this screen; the hints here say what to have ready
 *    instead. Same question, different thing to say beside it.
 *  - `confirm-diagnosis`. The server emits it only when the diagnosis
 *    is not genetically confirmed, which it can check. This screen
 *    cannot — it runs with no profile — so it always offers it.
 *
 * WHAT A PROMPT MAY AND MAY NOT SAY
 * ---------------------------------
 * Every entry is a question. None of them tells a patient what should
 * be done to them. The two that touch a clinical recommendation point
 * at 我的随访计划, where the AAN 2015 recommendations live with their
 * evidence levels attached, rather than restating a recommendation here
 * with the level filed off — a 「Level C, some patients」 rendered as a
 * flat instruction is the failure that screen was built to avoid.
 */

export interface ReferralQuestion {
  id: string;
  prompt: string;
  /** What to have ready, or what the question is for. */
  hint: string;
  /** Required. A document number, or an explicit statement that this
   *  page wrote the sentence itself. */
  source: string;
}

export const REFERRAL_QUESTIONS: ReferralQuestion[] = [
  {
    id: 'confirm-diagnosis',
    prompt: '我这个诊断确定吗？要不要做基因检测？在哪做、大概多少钱、能不能报销？',
    hint: '如果你还没有基因报告，这一问值得放在最前面 —— 后面很多问题的答案都取决于它。',
    source: '本页自拟的提问，不是检测建议',
  },
  {
    id: 'registry',
    prompt: '我的病例要不要录入国家罕见病诊疗服务信息系统？',
    hint: '协作网医院有这项义务，不是给患者的额外恩惠。被登记进去，是以后参加研究和试验的前提之一。',
    source:
      '《国家卫生健康委办公厅关于建立全国罕见病诊疗协作网的通知》国卫办医函〔2019〕157号：「协作网医院要及时将诊治的罕见病患者相关信息录入登记系统。」',
  },
  {
    id: 'followup-where',
    prompt: '以后的随访放在哪家医院？本地医院能不能接？',
    hint: '把「下次去哪、多久一次、谁负责」当场问清楚，比回家再打电话省一趟路。',
    source:
      '国卫办医函〔2019〕157号要求协作网医院之间建立双向转诊制度，成员医院按牵头医院制订的随访治疗方案做接续管理',
  },
  {
    id: 'which-tests',
    prompt: '按我现在的情况，哪些检查需要做？哪些暂时不用做？',
    hint: '检查费用多数要自己出，所以「不用做」和「要做」一样值得当面问清楚。',
    source: '本页自拟的提问，不是检查建议；具体项目与依据见本应用「我的随访计划」',
  },
  {
    id: 'rehab',
    prompt: '康复怎么安排？在哪做、多久一次、哪些动作要避开？',
    hint: '可以问能不能转介康复科或物理治疗师，以及有没有可以在家做的方案。',
    source: '本页自拟的提问，不是康复处方',
  },
  {
    id: 'devices',
    prompt: '辅具（AFO、肩托、助行器、轮椅）现在该不该配？去哪评估？',
    hint: '适配通常需要单独一次评估，问清楚挂哪个科，比回家再查省一趟。',
    source: '本页自拟的提问，不是辅具建议',
  },
  {
    id: 'family',
    prompt: '家里其他人要不要查？遗传咨询在哪做？',
    hint: 'FSHD 多为常染色体显性遗传。想问生育相关的问题，可以先看本应用「遗传与生育」那一页再来问。',
    source: '本页自拟的提问，不是遗传咨询意见',
  },
  {
    id: 'surgery',
    prompt: '如果以后要做手术或全身麻醉，我需要提前准备什么？',
    hint: '本应用可以生成一张麻醉提示卡，术前可以交给麻醉科。',
    source: '本页自拟的提问；术前肺功能一项的依据见本应用「我的随访计划」',
  },
  {
    id: 'next-visit',
    prompt: '下一次复诊什么时候？中间出现什么情况需要提前来？',
    hint: '把「什么情况要提前来」问成一句具体的话，回家才用得上。',
    source: '本页自拟的提问',
  },
];

/**
 * Composes the selected questions into one block of text.
 *
 * Text, not a file and not the clipboard: this app ships as a web export
 * that a large share of patients open inside WeChat's in-app browser,
 * which has no print dialog, and the project takes no new dependencies
 * — so there is no clipboard API here. A `selectable` Text that can be
 * long-pressed, or screenshotted, is what actually survives that
 * browser, and it is also the artefact that still works in a waiting
 * room with no signal.
 *
 * Returns `null` rather than an empty document when nothing is
 * selected, so the caller can keep the block off screen instead of
 * showing a heading over nothing.
 */
export const composeQuestionSheet = (
  selectedIds: readonly string[],
  ownNote: string,
): string | null => {
  const chosen = REFERRAL_QUESTIONS.filter((question) => selectedIds.includes(question.id));
  const note = ownNote.trim();
  if (chosen.length === 0 && note.length === 0) return null;

  const lines: string[] = ['我想问的问题'];
  chosen.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.prompt}`);
  });
  if (note.length > 0) {
    lines.push('我自己想问的：');
    lines.push(note);
  }
  return lines.join('\n');
};

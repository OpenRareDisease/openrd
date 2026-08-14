/**
 * The status words we are willing to say in Chinese, and nothing else.
 *
 * WHY A FIXED MAP AND NOT A TRANSLATOR
 *
 * The corpus snapshot this feature replaces
 * (`05.相关研究/…/A.全球范围内FSHD药物研究进展汇总.htm`, scraped
 * 2025-03-31) was machine translated. In it `Recruiting` reads 「招聘」
 * — a job opening — and `facioscapulohumeral` reads 「面肩关节疾病」.
 * A patient reading 「招聘」 next to a trial's name learns something
 * false about whether they can join it, and there was no way to notice
 * because nothing kept the English. So: six words, written by hand,
 * and anything else renders as the registry's own English.
 *
 * The six are fixed by the build contract (§A4). Adding a seventh is a
 * decision about what we tell patients, not a parser fix — make it
 * deliberately, in the contract, not in this file on the way past.
 *
 * WHAT IS DELIBERATELY NOT IN THE MAP, MEASURED
 *
 * Over the 92 studies clinicaltrials.gov returned for
 * `query.cond=facioscapulohumeral muscular dystrophy` on 2026-08-13
 * (the capture in __fixtures__/ctgov.page{1,2}.json, counted by
 * ctgov.fetcher.test.ts):
 *
 *   COMPLETED                45   mapped
 *   RECRUITING               21   mapped
 *   ACTIVE_NOT_RECRUITING     8   mapped
 *   TERMINATED                7   mapped
 *   NOT_YET_RECRUITING        1   mapped
 *   UNKNOWN                   7   NOT mapped -> renders as UNKNOWN
 *   ENROLLING_BY_INVITATION   3   NOT mapped -> renders as the English
 *
 * So ten of ninety-two rows show an English status word today. That is
 * the intended behaviour and not a gap to be quietly closed: ctgov's
 * `UNKNOWN` means 「the sponsor has not verified this record recently」,
 * which is not a status a patient can act on, and
 * `ENROLLING_BY_INVITATION` means 「recruiting, but not from the public」
 * — the one word where a careless 「招募中」 would tell a patient to go
 * and ask.
 *
 * `WITHDRAWN` is mapped and appears zero times in that capture. It is
 * in the contract's six, and a withdrawn trial is exactly the kind of
 * record that shows up later without warning.
 */

/**
 * ctgov's `protocolSection.statusModule.overallStatus` -> our Chinese.
 *
 * A Map rather than an object literal so a lookup can never walk the
 * prototype: `({} as Record<string, string>)['constructor']` is
 * truthy, and this value goes straight into a column a patient reads.
 */
export const CTGOV_STATUS_ZH: ReadonlyMap<string, string> = new Map([
  ['RECRUITING', '招募中'],
  ['ACTIVE_NOT_RECRUITING', '进行中·不再招募'],
  ['COMPLETED', '已完成'],
  ['TERMINATED', '已终止'],
  ['WITHDRAWN', '已撤回'],
  ['NOT_YET_RECRUITING', '尚未开始招募'],
]);

/**
 * `null` means 「show `statusRaw`」, never 「unknown status」. Callers
 * that render `statusZh ?? statusRaw` are correct; callers that render
 * `statusZh ?? '未知'` are inventing a fact about the trial.
 */
export const translateCtgovStatus = (statusRaw: string): string | null =>
  CTGOV_STATUS_ZH.get(statusRaw) ?? null;

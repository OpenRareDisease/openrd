/**
 * 临床试验名单 —— everything the screen is allowed to say, and the
 * arithmetic behind it, with no renderer attached.
 *
 * WHAT THIS PAGE IS. A copy of what two trial registries say, with the
 * date we copied it. Nothing else. It does not judge eligibility, it
 * does not summarise results, and it does not translate a status word
 * it was not given a translation for. Those three refusals are the
 * whole product here: a patient reading「招募中」on a card is reading
 * the word its own registry wrote, one hop removed.
 *
 * THE DATE IS NOT DECORATION. The list is a cache — `npm run
 * trials:refresh` fills it from a host cron, and the request path only
 * ever reads it. Fetching a registry inside a patient's request is
 * ruled out by design: production is a mainland VPS, an overseas
 * registry is exactly the kind of dependency that hangs, and a hung
 * fetch there is a spinner on the patient's screen. What that buys in
 * reliability it costs in currency, and the date is how that cost is
 * disclosed. A cached list with no date on it is a claim about the
 * present tense that nobody checked, so `resolveFetchedOn` returning
 * null is a state the screen has to handle by NOT showing the list —
 * not by showing it undated.
 *
 * WHICH GROUPS ARRIVE COLLAPSED, AND WHY THOSE. Census of the cache on
 * 2026-08-14, after `npm run trials:refresh`:
 *
 *   select status_raw, count(*) from trial_records group by 1 order by 2 desc;
 *   -- COMPLETED 45, RECRUITING 21, ACTIVE_NOT_RECRUITING 8,
 *   -- TERMINATED 7, UNKNOWN 7, ENROLLING_BY_INVITATION 3,
 *   -- NOT_YET_RECRUITING 1   (92 rows)
 *
 * Only 52 of those 92 are closed — COMPLETED plus TERMINATED — and
 * those are the ones that arrive collapsed together with the 8 that are
 * running without recruiting. A reader with limited arm elevation pays
 * for every screen of scroll, so 60 cards sit behind two 48pt toggles
 * that name their counts; each card still carries its own exact status,
 * because 已终止 and 已完成 are not the same fact about a drug and a
 * group header must not be the only place that difference is recorded.
 *
 * The rest are open on arrival, INCLUDING 其他状态 — the group for rows
 * whose status word this page could not place. `ENROLLING_BY_INVITATION`
 * lands there, and it is a study still taking participants by the
 * registry's own definition. Not translating a word we were given no
 * translation for is the rule; hiding the rows behind a shut toggle
 * labelled 其他状态 is not what that rule asks for, and it is the one
 * place this page could bury something a reader came for.
 *
 * TWO REGISTRIES, TWO VOCABULARIES, ONE COLUMN. Grouping reads
 * `status_raw` — the word the registry itself wrote — and it has to
 * read two vocabularies out of that one column: ctgov's
 * `overallStatus`, and 药物临床试验登记与信息公示平台's 试验状态, which
 * is Chinese. Its words are the ones that registry's own status filter
 * offers, and its result rows write the 进行中 sub-states as
 *「进行中 招募中」rather than as the sub-state alone; both spellings are
 * listed on the groups below, and a word from neither vocabulary still
 * has 其他状态 to land in.
 *
 * It cannot read `status_zh` for the mainland half instead, because
 * nothing writes one: that column is filled from the ctgov map alone
 * (`translateCtgovStatus`), and chinadrugtrials.fetcher.ts writes NULL
 * into it for every row it produces. A mainland row placed by a
 * translation is a row that never arrives, so every one of them used to
 * land in 其他状态 — a study the registry itself calls 招募中 filed
 * under 其他状态, with the group whose header is spelled with that same
 * word sitting above it, and a 已完成 study sitting outside 已完成或已
 * 停止 under a note explaining that we had no Chinese for its status.
 *
 * AND `status_raw` IS NOT THE ONLY SUCH COLUMN. Every free-text column
 * on this record holds two vocabularies, because two fetchers write it
 * and each copies its own registry's words: `countries` is `China` from
 * one and 中国 from the other, `phase` is `PHASE1/PHASE2` or `NA` from
 * one and a 试验分期 token from the other. A comparison written
 * against one registry's spelling and run over the whole list reads as
 * a fact about the study and is really a fact about which registry
 * happened to publish it — `hasChinaSite` said no about every mainland
 * record there is, and it said it on the half of the list a reader in
 * China can actually reach. Where a rule is genuinely one registry's,
 * `source` is on the row and the function takes the row.
 */

/* ------------------------------------------------------------------ */
/* Shape of the cache, as the API serves it                            */
/* ------------------------------------------------------------------ */

/** The two registries in migration 026's CHECK constraint. */
export const TRIAL_SOURCES = ['ctgov', 'chinadrugtrials'] as const;
export type TrialSourceKey = (typeof TRIAL_SOURCES)[number];

export interface TrialRecord {
  source: TrialSourceKey;
  /** NCT number for ctgov, CTR number for chinadrugtrials. */
  sourceId: string;
  /** The registry's own title, verbatim. English stays English — see
   *  the file header on why nothing here is machine-translated. */
  title: string;
  /** The registry's own status word, verbatim. */
  statusRaw: string;
  /** Our fixed translation, or null when we have none for that word.
   *  null means「show the English」, NOT「status unknown」. */
  statusZh: string | null;
  phase: string | null;
  sponsor: string | null;
  countries: string[];
  url: string;
  /** The registry's own last-changed day, `YYYY-MM-DD`. */
  sourceUpdatedAt: string | null;
  /** When *we* copied this row. ISO 8601 instant. */
  fetchedAt: string | null;
}

/** The latest row of `trial_fetch_runs` for one source. */
export interface TrialFetchRun {
  startedAt: string | null;
  /** null with `ok: false` means the run started and never came back —
   *  an OOM kill, a cron timeout, or a run still in flight. Migration
   *  026 makes `ok: true` with a null `finishedAt` unwritable, so this
   *  combination can only ever mean「no result yet」. */
  finishedAt: string | null;
  ok: boolean;
}

export interface TrialSourceStatus {
  source: TrialSourceKey;
  /** How many rows of `trial_records` this source currently has — the
   *  server's own count, or, when it arrives unreadable, the number of
   *  records that survived parsing (lib/trials-api.ts). */
  recordCount: number;
  /** Newest `fetched_at` across this source's rows, ISO 8601. */
  fetchedAt: string | null;
  /** Latest run, successful or not. */
  lastRun: TrialFetchRun | null;
  /** `finished_at` of the latest run with `ok = true`, ISO 8601. */
  lastSuccessAt: string | null;
}

export interface TrialsSnapshot {
  trials: TrialRecord[];
  sources: TrialSourceStatus[];
}

/* ------------------------------------------------------------------ */
/* Fixed copy                                                          */
/* ------------------------------------------------------------------ */

/** 药物临床试验登记与信息公示平台 — the mainland registry. It has no
 *  public API, so even once the scraper exists this list can go stale
 *  on that half without anyone noticing; the sentence below is what a
 *  patient needs in order to check for themselves. */
export const CHINA_REGISTRY_NAME = '药物临床试验登记与信息公示平台';
export const CHINA_REGISTRY_URL = 'http://www.chinadrugtrials.org.cn/';

/**
 * Where to go for the half this page does not have in hand. One
 * phrasing, ending every notice that has no mainland record to
 * describe — the reader gets the same instruction whether we never
 * looked, could not read the registry, or read it and came back with
 * nothing.
 */
const CHINA_REGISTRY_POINTER = `国内登记的试验请直接查${CHINA_REGISTRY_NAME}（chinadrugtrials.org.cn）。`;

/**
 * Shown when the snapshot says nothing at all about the mainland half:
 * the request is in flight, it failed, or it came back carrying no
 * source block for that registry. Every other state has a fact of its
 * own to state and states it (see `describeChinaCoverage`).
 *
 * IT NO LONGER SAYS 「本页只收录 ClinicalTrials.gov 的记录，不含仅在
 * 国内登记的试验」. That sentence described a platform that does not
 * fetch chinadrugtrials.org.cn, and this one does — the source is in
 * TRIAL_SOURCES, the cron runs it, and on the day this was written its
 * run came back successful with zero rows. Printed over that state it
 * told every patient the mainland registry was outside our scope when
 * what had actually happened is that we checked it and found nothing,
 * which is a different fact and a much smaller one. The scope claim is
 * deleted rather than qualified; what is left is what the reader can
 * check for themselves.
 *
 * 本页, not 本列表. The screen prints this while the request is in
 * flight and after it failed — states with no list under it at all —
 * so it says what is not on the page rather than what is in a list.
 */
export const COVERAGE_NOTE_NO_CHINA_RECORDS =
  `本页现在没有来自国内登记平台的记录。` + CHINA_REGISTRY_POINTER;

export const TRIALS_DISCLAIMER = '是否参加试验，请与你的主诊医生商量。';

/** Named on every card. Which registry a fact came from is part of the
 *  fact — it is what tells the reader where to go and check it. */
export const TRIAL_SOURCE_NAMES: Record<TrialSourceKey, string> = {
  ctgov: 'ClinicalTrials.gov',
  chinadrugtrials: CHINA_REGISTRY_NAME,
};

/**
 * Sits above the list. Says what the page is before the reader spends
 * attention on it — and rules out the two readings it must not invite.
 */
export const TRIALS_INTRO =
  '这里是注册库上登记的 FSHD 相关试验原文：状态、期别、申办方、地点和注册库最后更新的日期。' +
  '本页不判断你是否符合入组条件，也不介绍试验结果。';

/* ------------------------------------------------------------------ */
/* Status → group                                                      */
/* ------------------------------------------------------------------ */

export interface TrialGroupSpec {
  key: string;
  title: string;
  /** One line under the header, when the group's title is not enough on
   *  its own. Rendered by the screen; absent on every group whose title
   *  already says what it holds. */
  note?: string;
  /**
   * Status words as their own registry writes them: ClinicalTrials.gov
   * v2's `statusModule.overallStatus`, and the mainland registry's
   * 试验状态 cell. Compared case-insensitively, whitespace removed;
   * nothing else is normalised, and no word is ever mapped onto
   * another.
   *
   * The mainland words are the ones on that registry's own 试验状态
   * filter. Its results table writes the three 进行中 sub-states as the
   * parent and the sub-state together —「进行中 招募中」— and the filter
   * writes the sub-state alone, so both spellings are listed and both
   * are the registry's, not ours.
   */
  statusRawTokens: readonly string[];
  /** Open on arrival. False only for the two groups where every row is
   *  closed or no longer recruiting; see the file header for the census
   *  behind that split. */
  initiallyExpanded: boolean;
}

export const TRIAL_GROUP_SPECS: readonly TrialGroupSpec[] = [
  {
    key: 'recruiting',
    title: '招募中',
    statusRawTokens: ['RECRUITING', '招募中', '进行中 招募中'],
    initiallyExpanded: true,
  },
  {
    key: 'not_yet_recruiting',
    title: '尚未开始招募',
    statusRawTokens: ['NOT_YET_RECRUITING', '尚未招募', '进行中 尚未招募'],
    initiallyExpanded: true,
  },
  {
    key: 'active_not_recruiting',
    title: '进行中 · 不再招募',
    // 招募完成 is the mainland registry's own third sub-state of
    // 进行中: the study is running and its enrolment is closed, which
    // is what this header says.
    statusRawTokens: ['ACTIVE_NOT_RECRUITING', '招募完成', '进行中 招募完成'],
    initiallyExpanded: false,
  },
  {
    key: 'closed',
    title: '已完成或已停止',
    // The mainland registry names who stopped it — the sponsor, the
    // ethics committee, the regulator — and that difference stays on
    // the card. 已完成或已停止 is true of all three.
    //
    // Its 暂停 words are deliberately absent. A study that is paused is
    // neither stopped nor recruiting, this page has no group that would
    // be true of it, and 其他状态 shows the registry's own word rather
    // than filing it under a header that would overstate what happened.
    statusRawTokens: [
      'COMPLETED',
      'TERMINATED',
      'WITHDRAWN',
      '已完成',
      '主动终止',
      'IEC/IRB终止',
      '责令终止',
    ],
    initiallyExpanded: false,
  },
];

/**
 * Anything whose status word no group above recognises. Its cards show
 * the registry's word untouched — guessing at a translation is how the
 * old corpus snapshot ended up rendering `Recruiting` as「招聘」.
 *
 * THE NOTE SAYS WHY THE ROWS ARE HERE, NOT WHAT THE WORDS ARE. It used
 * to say the platform had no fixed Chinese for these status words and
 * offer `ENROLLING_BY_INVITATION` as the example. Both halves fail on
 * the first mainland row that reaches this group: that registry writes
 * its status in Chinese, so the sentence would explain a Chinese card
 * by saying we could not render one, and the example names a word that
 * is on no card in the group. What is left is true of every row that
 * can land here, whichever registry wrote it.
 */
export const OTHER_GROUP_SPEC: TrialGroupSpec = {
  key: 'other',
  title: '其他状态',
  note:
    '这些记录的状态词没有归进上面任何一组，卡片上按注册库的原词显示。' +
    '其中可能有仍在入组的试验，请点开原始记录确认。',
  statusRawTokens: [],
  // Open on arrival, unlike the two closed groups: a row lands here
  // because its word was not placed, which is not the same as its study
  // being over — ENROLLING_BY_INVITATION is a study still taking
  // participants — and a shut toggle is the one way this page could
  // hide a study a reader came for.
  initiallyExpanded: true,
};

export interface TrialGroup {
  spec: TrialGroupSpec;
  trials: TrialRecord[];
}

/**
 * Whitespace goes because the mainland registry's results table writes
 * 「进行中 招募中」 with the parent and the sub-state separated, and its
 * own filter writes the sub-state alone. Removing it compares the two
 * spellings of one word equal; it never brings two different words
 * together, and case folding is a no-op on Chinese.
 */
const normalizeRawStatus = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

/**
 * ONE PASS, OVER THE WORD THE REGISTRY ITSELF WROTE.
 *
 * `status_zh` is not consulted, and consulting it would be a way to get
 * this wrong rather than a fallback. It is our own column: the refresh
 * fills it from `translateCtgovStatus`, whose every key is a ctgov word
 * already listed above, and leaves it NULL for every mainland row. So
 * it can only ever confirm a placement `status_raw` had already made,
 * or contradict one — a row whose `status_raw` is NOT_YET_RECRUITING
 * and whose `status_zh` is a mapping edit behind, still saying 招募中,
 * would be filed under 招募中, which is the one group a patient acts
 * on.
 */
export const groupKeyForTrial = (trial: TrialRecord): string => {
  const raw = normalizeRawStatus(trial.statusRaw);
  const byRaw = TRIAL_GROUP_SPECS.find((spec) =>
    spec.statusRawTokens.some((token) => normalizeRawStatus(token) === raw),
  );
  return byRaw ? byRaw.key : OTHER_GROUP_SPEC.key;
};

/**
 * What a card's status chip reads.
 *
 * `status_zh` first because it is the one translation this product
 * controls; the registry's own word when we have no translation. Never
 * a guess, and never blank — an empty chip on a trial card would read
 * as「状态未知」, which is a different and unearned claim.
 */
export const trialStatusLabel = (trial: TrialRecord): string => {
  const zh = trial.statusZh?.trim();
  if (zh) return zh;
  const raw = trial.statusRaw.trim();
  return raw || '注册库未标注状态';
};

/**
 * ClinicalTrials.gov's `designModule.phases` enum, spelled out.
 *
 * These are fixed enum members with published meanings, not prose, so
 * translating them is the same kind of act as `status_zh`. `NA` is the
 * value the registry uses for studies that are not organised by phase
 * at all — device and behavioural studies — which is what 不按期别划分
 * says and all it says.
 *
 * An unrecognised token is passed through untouched. The API stores
 * `phase` as free text (migration 026) and the mainland registry does
 * not use this vocabulary, so this map is a courtesy for one source,
 * not a parser — and `trialPhaseLabel` runs it over that one source's
 * rows only.
 */
const PHASE_LABELS: Record<string, string> = {
  EARLY_PHASE1: '早期 1 期',
  PHASE1: '1 期',
  PHASE2: '2 期',
  PHASE3: '3 期',
  PHASE4: '4 期',
  NA: '不按期别划分',
};

/**
 * The registry's own phase token, rendered.
 *
 * TAKES THE ROW, NOT THE COLUMN, because `phase` holds two vocabularies
 * and neither of them is a display string — apps/api's refresh.ts says
 * so on the column itself: ctgov writes `PHASE1`, `PHASE1/PHASE2` or
 * `NA`, chinadrugtrials writes its 试验分期 cell, which is `I期` on the
 * record captured for that fetcher's test. Both things done below are
 * ctgov's and only ctgov's. The map's keys are its enum members. The
 * split is there because its `phases` is an ARRAY — a study registered
 * across two phases — and each element has to be looked up on its own
 * whichever separator the refresher joined them with.
 *
 * Run over a mainland token that pair can only do damage, never good:
 * no Chinese word is a key of the map, so the lookup can never fire,
 * while a 试验分期 spelled with one of those separators would come back
 * respelled with spaces around a slash. That registry does write `/`
 * inside single words of its own controlled vocabularies —
 * `IEC/IRB终止` is one of the status words listed above — and this page
 * does not get to change the spelling of a word a registry wrote.
 */
export const trialPhaseLabel = (trial: TrialRecord): string | null => {
  const raw = trial.phase?.trim();
  if (!raw) return null;
  if (trial.source !== 'ctgov') return raw;
  const parts = raw
    .split(/[|,/、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((part) => PHASE_LABELS[normalizeRawStatus(part)] ?? part).join(' / ');
};

/**
 * True when the registry lists a site in mainland China.
 *
 * ONE LITERAL PER REGISTRY, in the vocabulary that registry writes its
 * locations in. ClinicalTrials.gov's `location.country` is English and
 * spells it `China`; the mainland platform's 各参加机构信息 table has a
 * 国家或地区 column and spells it 中国 — the fetcher takes that cell
 * verbatim, so the Chinese string is what reaches this list.
 *
 * Checking only the English one is what this used to do, and it turned
 * the chip off for the registry it matters most on: every record from
 * chinadrugtrials.org.cn writes 中国 there and not one of them could
 * earn the chip. The chip exists to tell a reader in mainland China
 * that the rest of the card is worth reading, and the half of the list
 * most likely to be worth reading was the half that never got it.
 *
 * Still an exact match on the string itself, because that is the only
 * check available that does not invent geography: a study listing only
 * `Taiwan`, `Hong Kong` or a 中国台湾 / 中国香港 spelling does NOT get
 * this chip, and neither does a study whose locations the refresher
 * could not read. It says where the registry says the study runs. It
 * says nothing about whether a given patient can join, which is the
 * sentence this page is not allowed to write.
 */
const CHINA_SITE_LITERALS = ['china', '中国'];

export const hasChinaSite = (trial: TrialRecord): boolean =>
  trial.countries.some((country) => CHINA_SITE_LITERALS.includes(country.trim().toLowerCase()));

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The registry's own last-changed day, or null.
 *
 * Accepts `YYYY-MM-DD` and nothing else. `source_updated_at` is a
 * `date` column — a calendar day with no instant and no zone — and the
 * moment it is serialised as a timestamp instead, reading a day back
 * out of it means picking a timezone to be wrong in. A card that says
 * 「注册库更新于 2026-05-31」 for a row the registry changed on 06-01 is
 * a wrong date presented with full confidence, so an unrecognised
 * shape becomes「注册库未提供」rather than a guess one day out.
 */
export const readRegistryDay = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!ISO_DAY.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Rejects 2026-02-30 and friends: `Date` rolls them forward rather
  // than failing, so the round-trip is the check.
  return parsed.toISOString().slice(0, 10) === trimmed ? trimmed : null;
};

/**
 * An instant rendered as the day it fell on *for the reader*.
 *
 * Unlike `readRegistryDay` this one is a timestamptz, so a timezone is
 * exactly the right thing to apply: the patient wants to know whether
 * this was copied today.
 */
export const formatInstantAsDay = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${parsed.getFullYear()}-${month}-${day}`;
};

/* ------------------------------------------------------------------ */
/* Reading the snapshot                                                */
/* ------------------------------------------------------------------ */

export const sourceStatusOf = (
  snapshot: TrialsSnapshot,
  source: TrialSourceKey,
): TrialSourceStatus | null => snapshot.sources.find((entry) => entry.source === source) ?? null;

export const trialsFromSource = (snapshot: TrialsSnapshot, source: TrialSourceKey): TrialRecord[] =>
  snapshot.trials.filter((trial) => trial.source === source);

/**
 * The day「拉取于」names, or null when we cannot name one.
 *
 * THE OLDEST INSTANT, not the newest. Each refresh run stamps every row
 * of its own source with one `fetched_at`, so with a single working
 * source the two are identical — the choice only bites when the list is
 * a union and one half has not been refreshed as recently. There, the
 * newest would put today's date over rows copied a month ago;「this
 * list is at least this old」is the reading that cannot mislead, and a
 * reader who over-checks a registry loses nothing.
 *
 * The records' own `fetchedAt` and the source blocks' are both read.
 * They are the same `fetched_at` column from two ends, so this is not a
 * fallback that invents anything; it keeps the date line alive if the
 * API ever answers with records and no source summary, or vice versa.
 *
 * Returning null is a real outcome and the screen must refuse to draw
 * the list on it. See the file header.
 */
const readableInstants = (snapshot: TrialsSnapshot): Array<{ value: string; time: number }> =>
  [
    ...snapshot.sources.map((entry) => entry.fetchedAt),
    ...snapshot.trials.map((trial) => trial.fetchedAt),
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => ({ value, time: new Date(value).getTime() }))
    .filter((entry) => !Number.isNaN(entry.time));

export const resolveFetchedOn = (snapshot: TrialsSnapshot): string | null => {
  const instants = readableInstants(snapshot);
  if (instants.length === 0) return null;
  const oldest = instants.reduce((best, entry) => (entry.time < best.time ? entry : best));
  return formatInstantAsDay(oldest.value);
};

/**
 * The day the studies on screen are dated — or null when no studies are
 * on screen at all.
 *
 * THE ONE ANSWER to whether this reader is looking at a list, and every
 * sentence that points at one has to ask it. A snapshot can arrive and
 * still put nothing in front of the reader, and both ways it does that
 * used to be described as though the list were there:
 *
 *  - nothing came back at all, so `describeEmptyList` speaks instead;
 *  - records came back with no readable copy time, so the screen
 *    refuses to draw them undated (see the file header).
 *
 * The notices above the list stay rendered through both, which is why a
 * clause like 「下面这份名单…」 or 「重要的试验请点开原始记录核对」 is a
 * false sentence in either one unless it is gated on this.
 *
 * `resolveFetchedOn` alone is not that gate: it reads the source blocks
 * as well as the records, so a snapshot whose records all failed to
 * parse still carries a date. Dated and empty is a real combination,
 * and the date belongs to a list that is not there.
 *
 * It returns the date rather than a boolean so the screen dates its
 * header off the same call that decides the list is drawable, instead
 * of arithmetic of its own that could drift from what the copy claims.
 *
 * IT IS THE FLOOR, NOT THE WHOLE TEST. A sentence about ONE registry's
 * rows needs to know that registry put rows in the list, which this
 * cannot answer — the list is a union and either half can be all of
 * it. `describeCtgovStaleness` asks the stronger question instead, and
 * gets this one's answer with it.
 */
export const shownListFetchedOn = (snapshot: TrialsSnapshot): string | null =>
  snapshot.trials.length > 0 ? resolveFetchedOn(snapshot) : null;

/*
 * THERE IS NO PER-ROW STALENESS NOTICE, and the reason is that the data
 * cannot carry one. This page used to print 「这一条是 X 抄的，之后几次
 * 抓取都没有再取到它」 on any row whose `fetched_at` fell behind the
 * newest instant in the snapshot. No row can be in that state:
 * `replaceTrialRecords` (apps/api/src/modules/trials/trials.repository.ts)
 * DELETEs the studies the registry stopped returning and re-stamps every
 * survivor with the run's own `fetchedAt`, in one transaction, so a row
 * that outlived a fetch does not exist — and on 2026-08-14 the whole
 * ctgov half of the cache shares one instant
 * (`select count(distinct fetched_at) from trial_records` → 1). What the
 * old check actually caught was one SOURCE lagging the other by a
 * calendar day, and it said of those rows that fetches had run and come
 * back without them, which had not happened. The freshness the page can
 * honestly state is per source, and that is what the notices below do.
 */

/**
 * Order inside a group: whatever the registry touched most recently
 * first, undated rows last, then by id so two rows with the same date
 * do not swap places between renders.
 */
export const sortTrialsForDisplay = (trials: readonly TrialRecord[]): TrialRecord[] =>
  [...trials].sort((a, b) => {
    const dayA = readRegistryDay(a.sourceUpdatedAt);
    const dayB = readRegistryDay(b.sourceUpdatedAt);
    if (dayA !== dayB) {
      if (dayA === null) return 1;
      if (dayB === null) return -1;
      return dayA < dayB ? 1 : -1;
    }
    return a.sourceId.localeCompare(b.sourceId);
  });

/** Groups in the fixed order above, empty ones dropped. */
export const groupTrials = (trials: readonly TrialRecord[]): TrialGroup[] => {
  const buckets = new Map<string, TrialRecord[]>();
  for (const trial of trials) {
    const key = groupKeyForTrial(trial);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(trial);
    else buckets.set(key, [trial]);
  }
  return [...TRIAL_GROUP_SPECS, OTHER_GROUP_SPEC]
    .map((spec) => ({ spec, trials: sortTrialsForDisplay(buckets.get(spec.key) ?? []) }))
    .filter((group) => group.trials.length > 0);
};

/* ------------------------------------------------------------------ */
/* What the page says about each half of its own coverage              */
/* ------------------------------------------------------------------ */

export interface CoverageNotice {
  /** `plain` is a statement of scope; `warn` is a failure the reader
   *  is entitled to know about. */
  tone: 'plain' | 'warn';
  text: string;
}

const lastSuccessDay = (status: TrialSourceStatus | null): string | null =>
  formatInstantAsDay(status?.lastSuccessAt ?? null);

const lastSuccessClause = (status: TrialSourceStatus | null): string => {
  const day = lastSuccessDay(status);
  return day ? `上次成功抓取：${day}` : '到目前为止还没有成功抓取过';
};

/**
 * The one clause that describes the list rather than our copy of the
 * mainland half, so it is the one clause gated on `shownListFetchedOn`.
 * True of every state that reaches it: no mainland record is in the
 * snapshot on any of those paths, and the only other source is ctgov.
 */
const CHINA_ABSENT_LIST_SCOPE = '所以下面这份名单目前只有 ClinicalTrials.gov 的记录。';

/**
 * The three states with no mainland record in hand say the same things
 * in the same order: what became of our copy of that half, what the
 * list on screen therefore holds — ONLY when a list is on screen — and
 * where to go for the rest.
 *
 * `fact` and `caveat` end in 「，」 so the pointer closes the sentence
 * whether or not the middle clause is there.
 */
const chinaAbsenceNotice = (
  snapshot: TrialsSnapshot,
  tone: CoverageNotice['tone'],
  fact: string,
  caveat = '',
): CoverageNotice => ({
  tone,
  text:
    `${fact}${shownListFetchedOn(snapshot) ? CHINA_ABSENT_LIST_SCOPE : ''}` +
    `${caveat}${CHINA_REGISTRY_POINTER}`,
});

/**
 * What to say about the mainland half.
 *
 * The sentence has to be true about the list the reader is looking at,
 * and that depends on two things at once — whether any mainland rows
 * reached the screen, and whether the fetch that was supposed to put
 * them there worked. Needing the second is the whole reason
 * `trial_fetch_runs` is part of the feature rather than a log.
 *
 * Both failures this guards against are silent ones. A short list
 * presented calmly lets the reader take 「没有国内试验」 from a page that
 * simply could not reach the registry; rows presented calmly let them
 * take the survivors of an older run for what the registry says today.
 * So a fetch that failed, or that has not come back, is named along
 * with the day the mainland half last refreshed — and migration 026
 * makes `ok = true` with a null `finished_at` unwritable, which is why
 *「还没有返回结果」can cover a run that died and a run still going
 * without claiming which.
 *
 * AND WHETHER A LIST IS DRAWN AT ALL, which is why nothing here says
 *「其中」or「国内这几条」any more. This notice keeps its place above
 * the empty state and above the undated refusal, so a clause that
 * points at rows on screen is a false sentence wherever the screen drew
 * none. What is left points at our copy of the mainland half, which
 * exists in every state that renders this.
 * `CHINA_ABSENT_LIST_SCOPE` is the one clause that genuinely describes
 * the list, so it survives only when `shownListFetchedOn` says there is
 * a list to describe.
 *
 * A SUCCESSFUL RUN THAT RETURNED NOTHING IS ITS OWN STATE, and it is
 * the state production is in. It used to fall through to the fixed
 * sentence together with 「we have never run this scraper」, which read
 * as「本页只收录 ClinicalTrials.gov 的记录」— our absence, printed over
 * the registry's own zero. What separates them here is `lastRun`: a
 * run that exists and reports `ok` is us having looked.
 *
 * What that branch may NOT do is finish the thought. `ok = TRUE` with
 * no rows does not distinguish「the registry lists nothing matching」
 * from「our scrape read the pages and recognised nothing」, and the one
 * column that would — `source_reported_total`, migration 027 — is not
 * on the wire (no field of `TrialSourceStatus` holds it; the same
 * absence `describeEmptyList` works around). Deriving the registry's
 * zero from `ok` plus an empty list is the inference
 * apps/api/src/modules/trials/refresh.ts forbids, so the branch states
 * the two facts it has — the run succeeded, it brought back nothing —
 * and then refuses the conclusion out loud rather than leaving the
 * reader to draw it.
 */
export const describeChinaCoverage = (snapshot: TrialsSnapshot): CoverageNotice => {
  const status = sourceStatusOf(snapshot, 'chinadrugtrials');
  const records = trialsFromSource(snapshot, 'chinadrugtrials');
  const lastRun = status?.lastRun ?? null;
  const runFailed = Boolean(lastRun && !lastRun.ok);

  if (records.length > 0) {
    const fetchedOn = formatInstantAsDay(status?.fetchedAt ?? records[0]?.fetchedAt ?? null);
    const provenance =
      `国内这部分来自${CHINA_REGISTRY_NAME}` +
      `${fetchedOn ? `（抓取于 ${fetchedOn}）` : ''}。` +
      `该平台没有公开接口，只能按页面抓取，可能不完整，` +
      `请以 chinadrugtrials.org.cn 上的原始记录为准。`;
    if (!runFailed) return { tone: 'plain', text: provenance };
    const detail = lastRun?.finishedAt
      ? '国内这部分最近一次抓取没有成功'
      : '国内这部分最近一次抓取还没有返回结果';
    return {
      tone: 'warn',
      text: `${provenance}${detail}（${lastSuccessClause(status)}），此后有没有变过，这里看不出来。`,
    };
  }

  if (lastRun && !lastRun.ok) {
    const detail = lastRun.finishedAt
      ? '国内这部分这次没有取到'
      : '国内这部分最近一次抓取还没有返回结果';
    return chinaAbsenceNotice(snapshot, 'warn', `${detail}（${lastSuccessClause(status)}），`);
  }

  if (lastRun) {
    // Nothing failed, so this is not a `warn`: the cron did its work
    // and the mainland half of the cache is empty because of what came
    // back, not because something broke. A warning triangle here would
    // spend the one alarm this page has on a run that worked.
    //
    // Not `lastSuccessClause`: its no-success wording (「到目前为止还没
    // 有成功抓取过」) inside a sentence that just said the run reported
    // success is the contradiction `describeEmptyList` documents. The
    // day is printed bare rather than under 「上次成功抓取：」 because
    // here it belongs to the run being described — `lastRun.ok` is
    // true, so the latest run and the latest successful one are the
    // same run — and because the empty-list card can be on screen
    // directly under this one saying 「抓取本身报的是成功（上次成功抓
    // 取：…）」 about ctgov, with a different date in it.
    const successDay = lastSuccessDay(status);
    return chinaAbsenceNotice(
      snapshot,
      'plain',
      `国内这部分最近一次抓取${successDay ? `（${successDay}）` : ''}是成功的，` +
        `但一条记录都没有取回来，`,
      '这不等于国内就没有相关的试验，',
    );
  }

  // A source block with no run: this registry has never been fetched on
  // this database. Distinct from the branch above on purpose — 「we have
  // not looked」 and 「we looked and found nothing」 are different facts
  // about us, and only one of them is worth a reader's patience.
  if (status) {
    return chinaAbsenceNotice(snapshot, 'plain', '国内这部分还没有抓取过，');
  }

  // No block for the source at all. The server sends one per registry
  // whatever its state (apps/api trials.service.ts), so this is a
  // payload we cannot read rather than a state we can name — and the
  // fixed sentence is the one that claims nothing about the fetch.
  return { tone: 'plain', text: COVERAGE_NOTE_NO_CHINA_RECORDS };
};

/**
 * What to say about the ClinicalTrials.gov half when its own last run
 * did not succeed. Returns null when it did — a page that announced
 * every successful cron run would train the reader to skip the banner
 * that matters.
 *
 * Note this is about the refresh, not about the rows: the records
 * shown are still real records, they are just older than the date the
 * cron was supposed to make them. So the sentence names their age
 * rather than telling the reader to distrust them.
 *
 * WHICH IS ALSO WHY IT IS WITHHELD UNLESS CLINICALTRIALS.GOV RECORDS
 * ARE ON SCREEN. Every clause left in it has those records for its
 * subject —「…的记录是 X 抓到的」and「重要的试验请点开原始记录核对」
 * both point at rows, and the second asks the reader to go open one.
 *
 * Asking only whether A list was drawn is not that test, and the gap
 * between the two is a whole state: this registry's first run failing
 * leaves `trial_records` with nothing of its own in it — the refresh
 * writes rows only on the path that flips `ok` — while the mainland
 * half fetches normally and fills the screen. Over that snapshot the
 * banner explained the staleness of a source contributing not one row
 * to what the reader sees, and dated the mainland registry's list by a
 * ClinicalTrials.gov fetch that had never once succeeded. So the gate
 * is `trialsFromSource`, and the day is this source's own copy time —
 * `describeChinaCoverage` reads its half the same way, off the source
 * block with a record of that source as the fallback.
 *
 * Naming the half is the other half of the same fix. The list can be a
 * union whose two halves were copied on different days, and 「下面这份
 * 名单是 X 抓到的」 claimed one day for all of it. The noun phrase that
 * narrows it is the one `CHINA_ABSENT_LIST_SCOPE` already uses for
 * exactly these rows, not a second wording for them. The mainland
 * half's own date is stated by `describeChinaCoverage`, in the notice
 * above this one.
 *
 * The two states that already have a voice keep it, and this cannot
 * fire over either: a failed run over an empty list is exactly what
 * `describeEmptyList` says, and the undated card says why a list that
 * did come back is not being drawn — naming the day these rows were
 * copied means an instant `resolveFetchedOn` can read, and these rows
 * are in `trials`, so `shownListFetchedOn` is non-null and the screen
 * draws the list.
 *
 * ONE STATE IS LEFT SILENT ON PURPOSE: rows from this registry are
 * drawn and neither their own copy time nor their source block's can
 * be read. Both are the one `fetched_at` column — NOT NULL on the
 * table, one `to_char` on the way out — so the pair being unreadable
 * is a payload we cannot read rather than a fetch we can date. The
 * only other day available is `shownListFetchedOn`, which on a union
 * is whichever half was copied first and may be the mainland
 * registry's, and putting that day on a ClinicalTrials.gov sentence is
 * the thing this function stopped doing.
 */
export const describeCtgovStaleness = (snapshot: TrialsSnapshot): CoverageNotice | null => {
  const status = sourceStatusOf(snapshot, 'ctgov');
  const lastRun = status?.lastRun ?? null;
  if (!lastRun || lastRun.ok) return null;
  const records = trialsFromSource(snapshot, 'ctgov');
  if (records.length === 0) return null;
  const fetchedOn = formatInstantAsDay(status?.fetchedAt ?? records[0]?.fetchedAt ?? null);
  if (!fetchedOn) return null;
  const detail = lastRun.finishedAt ? '最近一次更新没有成功' : '最近一次更新还没有返回结果';
  return {
    tone: 'warn',
    text:
      `${detail}（${lastSuccessClause(status)}）。` +
      `下面这份名单里 ClinicalTrials.gov 的记录是 ${fetchedOn} 抓到的，` +
      `注册库上此后的变化不会反映在这里，重要的试验请点开原始记录核对。`,
  };
};

/**
 * When there is nothing to show at all, why.
 *
 * Never「暂无试验」, and — the harder half — never「注册库没有相关记
 * 录」either. This function has four states and NONE of them is a
 * statement about what FSHD research exists:
 *
 *  - no run on record → we have not looked yet.
 *  - the last run failed, or has not come back → we could not read the
 *    registry, plus the day we last could.
 *  - the run succeeded and some source still reports a non-zero
 *    `recordCount` → none of those records reached the screen:
 *    `asTrialRecord` dropped every element, or `trials` came back
 *    missing or not an array (lib/trials-api.ts).
 *  - the run succeeded and no source reports any row → still ours,
 *    though we cannot say where. ctgov's fetcher refuses a
 *    `totalCount` of 0 outright (a zero from that endpoint means our
 *    query stopped meaning FSHD, not that the archive emptied — see
 *    apps/api ctgov.fetcher.ts), and the refresh writes the rows and
 *    flips `ok = TRUE` inside one transaction, so a ctgov run that
 *    reached `ok` did write at least one row. Reading none of them
 *    back is a break somewhere on our side — hence 「平台」 for this
 *    one and 「本应用」 for the branch above.
 *
 * The registry's own zero would be a different sentence, and the only
 * thing that could carry it is `source_reported_total` (migration
 * 027), which is server-side: no field of `TrialSourceStatus` above
 * holds it. Deriving it instead from `ok` plus an empty list is
 * exactly the inference apps/api/src/modules/trials/refresh.ts
 * forbids, and it is the sentence a patient would act on.
 */
export const describeEmptyList = (snapshot: TrialsSnapshot): string => {
  const status = sourceStatusOf(snapshot, 'ctgov');
  const lastRun = status?.lastRun ?? null;
  if (!lastRun) {
    return '这份名单还没有抓取过。请稍后再打开，或直接到 clinicaltrials.gov 上查询。';
  }
  if (!lastRun.ok) {
    return `注册库这次没有取到（${lastSuccessClause(status)}）。请稍后再打开，或直接到 clinicaltrials.gov 上查询。`;
  }
  if (snapshot.sources.some((entry) => entry.recordCount > 0)) {
    return '这一次没有一条记录能完整读出来 —— 这是本应用这边的问题，不是注册库上没有 FSHD 试验。请稍后重试，或直接到 clinicaltrials.gov 上查询。';
  }
  // Not `lastSuccessClause`: its no-success wording (「到目前为止还没有
  // 成功抓取过」) would end up inside 「抓取本身报的是成功（…）」.
  const successDay = lastSuccessDay(status);
  const when = successDay ? `（上次成功抓取：${successDay}）` : '';
  return `抓取本身报的是成功${when}，但这里一条记录都没有 —— 这是平台这边的问题，不是注册库上没有 FSHD 试验。请直接到 clinicaltrials.gov 上查询。`;
};

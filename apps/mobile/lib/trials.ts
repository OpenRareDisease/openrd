/**
 * 临床试验名单 —— everything the screen is allowed to say, and the
 * arithmetic behind it, with no renderer attached.
 *
 * WHAT THIS PAGE IS. A copy of what two trial registries say, with the
 * date we copied it. Nothing else. It does not judge eligibility, it
 * does not summarise results, and it does not translate a status word
 * it was not given a translation for. Those three refusals are the
 * whole product here: a patient reading「招募中」on this page is
 * reading ClinicalTrials.gov's own `overallStatus`, one hop removed.
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
 * The other 40 are open on arrival, INCLUDING 其他状态. That group is
 * the 10 rows whose registry word §A4 gives us no Chinese for, and
 * three of them are `ENROLLING_BY_INVITATION` — studies still taking
 * participants, by the registry's own definition. Not translating a
 * word we were given no translation for is the rule; hiding the rows
 * behind a shut toggle labelled 其他状态 is not what that rule asks
 * for, and it is the one place this page could bury something a reader
 * came for.
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
  /** How many rows of `trial_records` this source currently has. */
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
 * Shown when the list on screen contains nothing from the mainland
 * registry — which is its state whenever that scraper has never
 * succeeded. It is a statement about the list the reader is looking
 * at, so it must not be printed when the list does in fact carry
 * mainland records (see `describeChinaCoverage`).
 */
export const COVERAGE_NOTE_CTGOV_ONLY =
  `本列表来自 ClinicalTrials.gov，不含仅在国内登记的试验。` +
  `国内登记的试验请查${CHINA_REGISTRY_NAME}（chinadrugtrials.org.cn）。`;

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
  /** Registry status words, as ClinicalTrials.gov v2 writes them in
   *  `statusModule.overallStatus`. Compared case-insensitively after
   *  trimming; nothing else is normalised. */
  statusRawTokens: readonly string[];
  /** The translations migration 026's `status_zh` is meant to carry
   *  for those words. A row whose `statusRaw` we do not recognise —
   *  the mainland registry writes Chinese in that column — is placed
   *  by its `status_zh` instead, so it lands in the right group rather
   *  than in 其他状态. */
  statusZhLabels: readonly string[];
  /** Open on arrival. False only for the two groups where every row is
   *  closed or no longer recruiting; see the file header for the census
   *  behind that split. */
  initiallyExpanded: boolean;
}

export const TRIAL_GROUP_SPECS: readonly TrialGroupSpec[] = [
  {
    key: 'recruiting',
    title: '招募中',
    statusRawTokens: ['RECRUITING'],
    statusZhLabels: ['招募中'],
    initiallyExpanded: true,
  },
  {
    key: 'not_yet_recruiting',
    title: '尚未开始招募',
    statusRawTokens: ['NOT_YET_RECRUITING'],
    statusZhLabels: ['尚未开始招募'],
    initiallyExpanded: true,
  },
  {
    key: 'active_not_recruiting',
    title: '进行中 · 不再招募',
    statusRawTokens: ['ACTIVE_NOT_RECRUITING'],
    statusZhLabels: ['进行中·不再招募'],
    initiallyExpanded: false,
  },
  {
    key: 'closed',
    title: '已完成或已停止',
    statusRawTokens: ['COMPLETED', 'TERMINATED', 'WITHDRAWN'],
    statusZhLabels: ['已完成', '已终止', '已撤回'],
    initiallyExpanded: false,
  },
];

/** Anything whose status word neither list recognises. Its cards show
 *  the registry's word untouched — guessing at a translation is how
 *  the old corpus snapshot ended up rendering `Recruiting` as「招聘」. */
export const OTHER_GROUP_SPEC: TrialGroupSpec = {
  key: 'other',
  title: '其他状态',
  note:
    '这些记录的状态词本平台没有固定的中文译法，卡片上按注册库的原词显示。' +
    '其中可能有仍在入组的试验（例如 ENROLLING_BY_INVITATION：受邀才能参加），请点开原始记录确认。',
  statusRawTokens: [],
  statusZhLabels: [],
  // Open on arrival, unlike the two closed groups. See the file header:
  // 3 of the 10 rows here are still enrolling, and a shut toggle is the
  // one way this page could hide a study a reader came for.
  initiallyExpanded: true,
};

export interface TrialGroup {
  spec: TrialGroupSpec;
  trials: TrialRecord[];
}

const normalizeRawStatus = (value: string): string => value.trim().toUpperCase();

/** `进行中·不再招募` vs `进行中 · 不再招募` — the group title spaces the
 *  middle dot for legibility and `status_zh` does not, so comparison
 *  drops whitespace rather than requiring the two to be typed
 *  identically in two files. */
const normalizeZhStatus = (value: string): string => value.replace(/\s+/g, '');

/**
 * Two passes, and the order matters.
 *
 * The registry's own word is checked against EVERY group before
 * `status_zh` is consulted for any of them. Interleaving the two — one
 * spec's raw tokens, then its Chinese labels, then the next spec's —
 * lets a stale or mismatched translation outrank an exact match on the
 * registry's word: a row whose `status_raw` is NOT_YET_RECRUITING and
 * whose `status_zh` still says 招募中 would be filed under 招募中,
 * which is the one group a patient acts on.
 */
export const groupKeyForTrial = (trial: TrialRecord): string => {
  const raw = normalizeRawStatus(trial.statusRaw);
  const byRaw = TRIAL_GROUP_SPECS.find((spec) =>
    spec.statusRawTokens.some((token) => normalizeRawStatus(token) === raw),
  );
  if (byRaw) return byRaw.key;

  const zh = trial.statusZh ? normalizeZhStatus(trial.statusZh) : null;
  const byZh = zh
    ? TRIAL_GROUP_SPECS.find((spec) =>
        spec.statusZhLabels.some((label) => normalizeZhStatus(label) === zh),
      )
    : undefined;
  return byZh ? byZh.key : OTHER_GROUP_SPEC.key;
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
 * not a parser.
 */
const PHASE_LABELS: Record<string, string> = {
  EARLY_PHASE1: '早期 1 期',
  PHASE1: '1 期',
  PHASE2: '2 期',
  PHASE3: '3 期',
  PHASE4: '4 期',
  NA: '不按期别划分',
};

/** A study may be registered across two phases; ctgov's `phases` is an
 *  array, and whichever separator the refresher joined it with, each
 *  token is looked up on its own. */
export const trialPhaseLabel = (phase: string | null): string | null => {
  const raw = phase?.trim();
  if (!raw) return null;
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
 * Exact match on the registry's literal `China`, because that is the
 * only string this can check without inventing geography: a study
 * listing only `Taiwan` or `Hong Kong` does NOT get this chip, and a
 * study whose locations the refresher could not read does not either.
 * It says where the registry says the study runs. It says nothing
 * about whether a given patient can join, which is the sentence this
 * page is not allowed to write.
 */
export const hasChinaSite = (trial: TrialRecord): boolean =>
  trial.countries.some((country) => country.trim().toLowerCase() === 'china');

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

const lastSuccessClause = (status: TrialSourceStatus | null): string => {
  const day = formatInstantAsDay(status?.lastSuccessAt ?? null);
  return day ? `上次成功抓取：${day}` : '到目前为止还没有成功抓取过';
};

/**
 * What to say about the mainland half.
 *
 * Five states, and the difference between them is the whole reason
 * `trial_fetch_runs` is part of the feature rather than a log:
 *
 *  - no records and no run on record → the fixed A5 sentence: this
 *    list is ClinicalTrials.gov only, here is where to look for the
 *    rest. True, and the state this ships in.
 *  - no records and the last run failed → say the fetch is failing and
 *    when it last worked. A short list presented in silence is the
 *    failure this whole table exists to prevent: the reader would take
 *    「没有国内试验」 from a page that simply could not reach the
 *    registry.
 *  - no records and the last run has not come back → same sentence,
 *    worded so it is true whether the run died or is still going.
 *    Migration 026 makes `ok = true` with a null `finished_at`
 *    unwritable, so「还没有返回结果」covers both without claiming which.
 *  - records present, last run ok → the fixed sentence would now be
 *    false about the list on screen, so it is replaced by one that is
 *    true: where the mainland rows came from, and that they may be
 *    incomplete.
 *  - records present, last run NOT ok → the rows on screen are the
 *    survivors of an older run and nothing says the registry still
 *    agrees with them. Showing them under the calm sentence above would
 *    be the silent-staleness version of the same failure, so this one
 *    warns and names the day the mainland half stopped being refreshed.
 */
export const describeChinaCoverage = (snapshot: TrialsSnapshot): CoverageNotice => {
  const status = sourceStatusOf(snapshot, 'chinadrugtrials');
  const records = trialsFromSource(snapshot, 'chinadrugtrials');
  const lastRun = status?.lastRun ?? null;
  const runFailed = Boolean(lastRun && !lastRun.ok);

  if (records.length > 0) {
    const fetchedOn = formatInstantAsDay(status?.fetchedAt ?? records[0]?.fetchedAt ?? null);
    const provenance =
      `其中国内登记的试验来自${CHINA_REGISTRY_NAME}` +
      `${fetchedOn ? `（抓取于 ${fetchedOn}）` : ''}。` +
      `该平台没有公开接口，这部分只能按页面抓取，可能不完整，` +
      `请以 chinadrugtrials.org.cn 上的原始记录为准。`;
    if (!runFailed) return { tone: 'plain', text: provenance };
    const detail = lastRun?.finishedAt
      ? '国内这部分最近一次抓取没有成功'
      : '国内这部分最近一次抓取还没有返回结果';
    return {
      tone: 'warn',
      text: `${provenance}${detail}（${lastSuccessClause(status)}），国内这几条此后有没有变过，这里看不出来。`,
    };
  }

  if (lastRun && !lastRun.ok) {
    const detail = lastRun.finishedAt
      ? '国内这部分这次没有取到'
      : '国内这部分最近一次抓取还没有返回结果';
    return {
      tone: 'warn',
      text:
        `${detail}（${lastSuccessClause(status)}），` +
        `所以下面这份名单目前只有 ClinicalTrials.gov 的记录。` +
        `国内登记的试验请直接查${CHINA_REGISTRY_NAME}（chinadrugtrials.org.cn）。`,
    };
  }

  return { tone: 'plain', text: COVERAGE_NOTE_CTGOV_ONLY };
};

/**
 * What to say about the ClinicalTrials.gov half when its own last run
 * did not succeed. Returns null when it did — a page that announced
 * every successful cron run would train the reader to skip the banner
 * that matters.
 *
 * Note this is about the refresh, not about the list: the records
 * shown are still real records, they are just older than the date the
 * cron was supposed to make them. So the sentence names the age of the
 * list rather than telling the reader to distrust it.
 */
export const describeCtgovStaleness = (snapshot: TrialsSnapshot): CoverageNotice | null => {
  const status = sourceStatusOf(snapshot, 'ctgov');
  const lastRun = status?.lastRun ?? null;
  if (!lastRun || lastRun.ok) return null;
  const fetchedOn = resolveFetchedOn(snapshot);
  const detail = lastRun.finishedAt ? '最近一次更新没有成功' : '最近一次更新还没有返回结果';
  return {
    tone: 'warn',
    text:
      `${detail}（${lastSuccessClause(status)}）。` +
      `${fetchedOn ? `下面这份名单是 ${fetchedOn} 抓到的，` : ''}` +
      `注册库上此后的变化不会反映在这里，重要的试验请点开原始记录核对。`,
  };
};

/**
 * When there is nothing to show at all, why.
 *
 * Never「暂无试验」. An empty list produced by a failed fetch and an
 * empty list produced by an empty registry are different facts, and
 * only one of them is about FSHD.
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
  return '最近一次抓取成功了，但注册库这次没有返回任何 FSHD 相关的记录。请到 clinicaltrials.gov 上再确认一次。';
};

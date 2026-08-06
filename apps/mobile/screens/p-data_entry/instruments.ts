/**
 * Turning stored instrument administrations into the one line the
 * passport prints.
 *
 * THERE IS NO ANCHOR TABLE IN THIS FILE, AND THERE MUST NEVER BE ONE.
 *
 * The behavioural anchors for Brooke and Vignos live in exactly one
 * place — `apps/api/src/modules/patient-profile/instruments/brooke.ts`
 * and `vignos.ts` — where each Chinese sentence sits beside the English
 * it was translated from and the citation it came out of, frozen at v1
 * with a comment explaining that rewording one silently changes what
 * every previously stored score means. The client reads them over the
 * wire (`getInstrumentCatalogue`) and reads each stored administration's
 * own resolved anchor (`levelLabelZh`). A local copy would be a second
 * definition of what「3 级」means.
 *
 * WHY THAT MATTERS ON THE PASSPORT SPECIFICALLY
 *
 * A level is not a measurement, it is the name of a behaviour. 「3」on
 * its own is worse than useless in a clinic: Brooke runs 1-6 and Vignos
 * 1-10, both counting upward toward worse, while the MRC strength score
 * on this same record runs 0-5 counting upward toward better. A
 * neurologist who sees three FSHD patients a year will map a bare 「3」
 * onto whichever of those they used last.
 *
 * So `summarizeInstrument` produces nothing at all for a level it
 * cannot name. Not a placeholder, not the number on its own. The
 * server already models this the same way — `levelLabelZh` comes back
 * null rather than fabricated when the stored version is not in its
 * registry — and this file preserves the null instead of papering over
 * it. See `__tests__/instruments.test.ts`.
 */

import type { InstrumentAdministration, InstrumentCatalogueEntry } from '../../lib/api';

/**
 * Display-only naming for the passport headline.
 *
 * The catalogue's `nameZh` is「Brooke 上肢功能分级」, and the headline
 * this page is specified to print is「上肢 Brooke 3 级」— limb first,
 * because a clinician scanning the page is looking for the body part
 * before the eponym. Re-ordering a server string by hand is fragile, so
 * the two words are named here per key, and anything not listed falls
 * back to the server's own `nameZh`.
 *
 * This is presentation, not clinical content: no anchor, no range, no
 * direction. An instrument the registry adds later renders correctly
 * without touching this map — just less tersely.
 */
const DISPLAY_NAMES: Record<string, { limb: string; shortName: string }> = {
  brooke_upper_extremity: { limb: '上肢', shortName: 'Brooke' },
  vignos_lower_extremity: { limb: '下肢', shortName: 'Vignos' },
};

export interface InstrumentReading {
  level: number;
  /** Always non-empty. A reading with no anchor is not constructed. */
  anchor: string;
  administeredAt: string | null;
}

export interface InstrumentComparison {
  reading: InstrumentReading;
  /** 「去年同期」or「上次 03-14」— never both, never a guess. */
  label: string;
}

export interface InstrumentSummary {
  instrumentKey: string;
  /** 「上肢 Brooke」, or the catalogue's nameZh for an unmapped key. */
  displayName: string;
  /** The catalogue entry, when the catalogue was reachable. Carries the
   *  citation and the documented limitations. */
  entry: InstrumentCatalogueEntry | null;
  latest: InstrumentReading;
  comparison: InstrumentComparison | null;
  /** 「上肢 Brooke 3 级（去年同期 2 级）」 */
  headline: string;
  /** Every usable reading, newest first. */
  history: InstrumentReading[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back「去年同期」looks for its partner reading. */
const ANNIVERSARY_TARGET_DAYS = 365;

/**
 * How far a reading may sit from the one-year mark and still be called
 * 「去年同期」.
 *
 * Four months either side, because these patients record when they
 * happen to have an appointment, not on an anniversary — a 9-month gap
 * and a 15-month gap are both "about a year ago" to the person reading
 * the line. Outside the window the comparison is still shown, but it is
 * labelled with its own date instead. Calling a four-month-old reading
 * 「去年同期」would be a small lie printed on the page a clinician reads.
 */
const ANNIVERSARY_WINDOW_DAYS = 120;

const parseTime = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

/** MM-DD, matching the rest of the passport's compact date style. */
const formatShortDate = (value: string | null): string | null => {
  const time = parseTime(value);
  if (time === null) return null;
  const date = new Date(time);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/** The one-item scale's levels, when the catalogue is available.
 *  Multi-item instruments have no single level to name, so they get
 *  none — the passport prints nothing for them rather than picking an
 *  item's anchor and calling it the instrument's. */
const singleItemLevels = (entry: InstrumentCatalogueEntry | null) =>
  entry && entry.items.length === 1 ? entry.items[0].levels : null;

export const instrumentDisplayName = (
  instrumentKey: string,
  entry: InstrumentCatalogueEntry | null,
  administration?: InstrumentAdministration | null,
): string => {
  const mapped = DISPLAY_NAMES[instrumentKey];
  if (mapped) return `${mapped.limb} ${mapped.shortName}`;
  return entry?.nameZh ?? administration?.instrumentNameZh ?? instrumentKey;
};

/**
 * One stored administration → one reading, or nothing.
 *
 * The anchor comes from the server's own `levelLabelZh` first: it was
 * resolved against the version the patient actually answered, which is
 * the only correct answer once a v2 exists. The catalogue is a fallback
 * for a server that stopped sending the label, and it is only usable
 * when the catalogue's current version matches the row's — otherwise it
 * would describe the level using words the patient never saw.
 */
export const readingFromAdministration = (
  administration: InstrumentAdministration | null | undefined,
  entry: InstrumentCatalogueEntry | null,
): InstrumentReading | null => {
  if (!administration) return null;
  // A superseded row is a corrected mis-tap. The list endpoint already
  // filters them out by default; this is the second gate, because a
  // trend drawn through a mistake and its correction shows a cliff that
  // never happened.
  if (administration.supersededById) return null;

  const level = administration.scoredValue;
  if (level === null) return null;

  let anchor = administration.levelLabelZh;
  if (!anchor) {
    const sameVersion =
      entry !== null &&
      administration.instrumentVersion !== null &&
      entry.version === administration.instrumentVersion;
    if (sameVersion) {
      anchor =
        singleItemLevels(entry)?.find((candidate) => candidate.value === level)?.labelZh ?? null;
    }
  }
  if (!anchor) return null;

  return { level, anchor, administeredAt: administration.administeredAt };
};

/**
 * Build the passport line for one instrument.
 *
 * Defensive throughout: this is fed from an endpoint whose deploy is
 * independent of this bundle's. Anything unusable produces `null`, and
 * `null` means the passport renders nothing at all for this instrument
 * — never a placeholder, never a level without its words.
 */
export const summarizeInstrument = (
  instrumentKey: string,
  administrations: InstrumentAdministration[] | null | undefined,
  entry: InstrumentCatalogueEntry | null = null,
): InstrumentSummary | null => {
  const list = Array.isArray(administrations) ? administrations : [];
  const own = list.filter((administration) => administration?.instrumentKey === instrumentKey);
  const readings = own
    .map((administration) => readingFromAdministration(administration, entry))
    .filter((reading): reading is InstrumentReading => reading !== null);

  if (readings.length === 0) return null;

  // The endpoint orders administered_at DESC. The passport must not
  // print last year's level as this year's if that ever slips, so the
  // order is re-established here. Readings with no usable date sink to
  // the bottom in their original order rather than being treated as
  // epoch-old.
  const sorted = [...readings].sort((a, b) => {
    const left = parseTime(a.administeredAt);
    const right = parseTime(b.administeredAt);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return right - left;
  });

  const latest = sorted[0];
  const older = sorted.slice(1);

  let comparison: InstrumentComparison | null = null;
  if (older.length > 0) {
    const latestTime = parseTime(latest.administeredAt);
    let anniversary: { reading: InstrumentReading; distance: number } | null = null;

    if (latestTime !== null) {
      const target = latestTime - ANNIVERSARY_TARGET_DAYS * DAY_MS;
      for (const reading of older) {
        const time = parseTime(reading.administeredAt);
        if (time === null) continue;
        const distance = Math.abs(time - target);
        if (distance > ANNIVERSARY_WINDOW_DAYS * DAY_MS) continue;
        if (!anniversary || distance < anniversary.distance) {
          anniversary = { reading, distance };
        }
      }
    }

    if (anniversary) {
      comparison = { reading: anniversary.reading, label: '去年同期' };
    } else {
      const previous = older[0];
      const shortDate = formatShortDate(previous.administeredAt);
      comparison = { reading: previous, label: shortDate ? `上次 ${shortDate}` : '上次' };
    }
  }

  const displayName = instrumentDisplayName(instrumentKey, entry, own[0]);
  const headline = comparison
    ? `${displayName} ${latest.level} 级（${comparison.label} ${comparison.reading.level} 级）`
    : `${displayName} ${latest.level} 级`;

  return { instrumentKey, displayName, entry, latest, comparison, headline, history: sorted };
};

/**
 * Every instrument the patient has a usable reading for, in catalogue
 * order where a catalogue is available.
 *
 * Driven by what came back, not by a hard-coded list of two: a third
 * scale added to the server's registry appears here without a client
 * release, and either of the two disappearing does not leave an empty
 * labelled slot behind.
 */
export const summarizeInstruments = (
  administrations: InstrumentAdministration[] | null | undefined,
  catalogue: InstrumentCatalogueEntry[] | null | undefined,
): InstrumentSummary[] => {
  const list = Array.isArray(administrations) ? administrations : [];
  const entries = Array.isArray(catalogue) ? catalogue : [];
  const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));

  const orderedKeys: string[] = [];
  for (const entry of entries) orderedKeys.push(entry.key);
  for (const administration of list) {
    const key = administration?.instrumentKey;
    if (key && !orderedKeys.includes(key)) orderedKeys.push(key);
  }

  return orderedKeys
    .map((key) => summarizeInstrument(key, list, entryByKey.get(key) ?? null))
    .filter((summary): summary is InstrumentSummary => summary !== null);
};

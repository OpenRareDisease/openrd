import {
  asFallRecord,
  asFallsSummary,
  deleteFall,
  getFallsSummary,
  listFalls,
  recordFall,
} from '../falls-api';
import { createFallDraft } from '../falls';

jest.mock('../api', () => ({ apiRequest: jest.fn() }));

const { apiRequest } = require('../api') as { apiRequest: jest.Mock };

/**
 * These assert against ACTUAL response bodies, copied from what the
 * API's falls.controller.ts sends.
 *
 * `apiRequest`'s type parameter is an unchecked assertion and it does
 * not unwrap the `{ data: ... }` envelope, so
 * `apiRequest<FallsListResult>('/profiles/me/falls')` typechecks,
 * passes any test written against a hand-made object, and can still be
 * wrong at runtime. lib/passport-share-api.ts records what that cost
 * the last time. A generic proves nothing; only a real body does.
 */

/** Exactly what `toFallDTO` produces — including `createdAt`, which
 *  this client deliberately does not carry. */
const FALL_BODY = {
  id: '11111111-1111-4111-8111-111111111111',
  occurredOn: '2026-08-01',
  daysAgo: 5,
  activity: 'stairs',
  location: 'indoor',
  handsFull: false,
  gotUpUnaided: null,
  injured: true,
  createdAt: '2026-08-01T12:00:00.000Z',
};

/** Exactly what `buildFallsSummary` produces. The per-column tallies
 *  are here because the server sends them; the client drops them. */
const SUMMARY_BODY = {
  total: 5,
  atCap: false,
  detailed: 3,
  latestDaysAgo: 5,
  oldestDaysAgo: 140,
  quarters: [
    { index: 0, startDaysAgo: 0, endDaysAgo: 89, count: 2 },
    { index: 1, startDaysAgo: 90, endDaysAgo: 179, count: 3 },
  ],
  location: { answered: 3, indoor: 2, outdoor: 1, unknown: 0 },
  activity: { answered: 3, top: { key: 'stairs', count: 2 } },
  handsFull: { answered: 2, yes: 1 },
  neededHelpUp: { answered: 1, yes: 1 },
  injured: { answered: 3, yes: 2 },
};

const LIST_BODY = { falls: [FALL_BODY], summary: SUMMARY_BODY, windowDays: 180 };

beforeEach(() => apiRequest.mockReset());

describe('the envelope, and the window that must not drift', () => {
  it('reads a bare body — what the profiles router actually sends', async () => {
    apiRequest.mockResolvedValue(LIST_BODY);
    const result = await listFalls(180);
    expect(result.falls).toHaveLength(1);
    expect(result.summary.total).toBe(5);
    expect(result.windowDays).toBe(180);
  });

  it('also survives a { data: ... } envelope, should a route ever grow one', async () => {
    apiRequest.mockResolvedValue({ data: LIST_BODY });
    const result = await listFalls(180);
    expect(result.summary.total).toBe(5);
  });

  it('sends the window it is going to print, rather than trusting the default', async () => {
    apiRequest.mockResolvedValue(LIST_BODY);
    await listFalls(180);
    expect(apiRequest.mock.calls[0][0]).toBe('/profiles/me/falls?windowDays=180');
  });
});

describe('a count that could not be read is not zero', () => {
  it('throws rather than resolving with a zeroed summary', async () => {
    // 「还没有跌倒记录」 is a claim about a patient's body. A failed
    // parse must not be allowed to make it.
    apiRequest.mockResolvedValue({ falls: [], windowDays: 180 });
    await expect(listFalls(180)).rejects.toThrow(/格式看不懂/);
  });

  it('a summary with no numeric total is null, not { total: 0 }', () => {
    expect(asFallsSummary({ atCap: false, quarters: [] })).toBeNull();
    expect(asFallsSummary(null)).toBeNull();
    expect(asFallsSummary('nope')).toBeNull();
  });

  it('getFallsSummary returns null so the caller can say「读不到」', async () => {
    apiRequest.mockResolvedValue({ summary: { quarters: [] } });
    await expect(getFallsSummary(180)).resolves.toBeNull();
  });

  it('an unreadable atCap flag is read as「可能不是全部」', () => {
    // The cautious direction: a missing flag must not let the screen
    // claim a complete total.
    expect(asFallsSummary({ total: 3 })?.atCap).toBe(true);
    expect(asFallsSummary({ total: 3, atCap: false })?.atCap).toBe(false);
  });
});

describe('what a fall row has to carry to be shown at all', () => {
  it('reads the enums and the tri-states off a real DTO', () => {
    const parsed = asFallRecord(FALL_BODY);
    expect(parsed).toEqual({
      id: FALL_BODY.id,
      occurredOn: '2026-08-01',
      daysAgo: 5,
      activity: 'stairs',
      location: 'indoor',
      handsFull: false,
      gotUpUnaided: null,
      injured: true,
    });
  });

  it('drops a row with no id — it could be shown but never deleted', () => {
    expect(asFallRecord({ ...FALL_BODY, id: undefined })).toBeNull();
  });

  it('drops a row whose date is not a real calendar day', () => {
    expect(asFallRecord({ ...FALL_BODY, occurredOn: '2026-02-31' })).toBeNull();
    expect(asFallRecord({ ...FALL_BODY, occurredOn: null })).toBeNull();
  });

  it('turns a value outside the enum into 「没填」, never into a label', () => {
    const parsed = asFallRecord({ ...FALL_BODY, activity: 'skydiving', location: 'moon' });
    expect(parsed?.activity).toBeNull();
    expect(parsed?.location).toBeNull();
  });

  it('never coerces a non-boolean into false', () => {
    // `Boolean(value)` here would turn an unanswered question into
    // 「否」 —— the one mistake this whole feature is built to avoid.
    const parsed = asFallRecord({
      ...FALL_BODY,
      injured: undefined,
      handsFull: 'true',
      gotUpUnaided: 0,
    });
    expect(parsed?.injured).toBeNull();
    expect(parsed?.handsFull).toBeNull();
    expect(parsed?.gotUpUnaided).toBeNull();
  });

  it('falls back to the device’s own arithmetic when daysAgo is missing', () => {
    // A 0 here would file an old fall as 今天 for anything reading it.
    const parsed = asFallRecord(
      { ...FALL_BODY, daysAgo: undefined, occurredOn: '2026-08-01' },
      new Date(2026, 7, 6),
    );
    expect(parsed?.daysAgo).toBe(5);
  });

  it('a list containing one unusable row still renders the rest', () => {
    apiRequest.mockResolvedValue({ ...LIST_BODY, falls: [FALL_BODY, { id: 'x' }, null] });
    return listFalls(180).then((result) => {
      expect(result.falls.map((entry) => entry.id)).toEqual([FALL_BODY.id]);
    });
  });
});

describe('recording one', () => {
  it('posts only the answered fields and returns the stored row', async () => {
    apiRequest.mockResolvedValue({ fall: FALL_BODY });
    const draft = { ...createFallDraft(new Date(2026, 7, 6)), injured: true };
    const saved = await recordFall(draft);

    const [path, init] = apiRequest.mock.calls[0];
    expect(path).toBe('/profiles/me/falls');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ occurredOn: '2026-08-06', injured: true });
    expect(saved.id).toBe(FALL_BODY.id);
  });

  it('throws with 「不要直接再存一次」 when the row does not come back', async () => {
    // The server has very likely committed by then. A patient told
    // only 「保存失败」 presses again, and two rows for one fall is a
    // number that goes to a doctor.
    apiRequest.mockResolvedValue({});
    await expect(recordFall(createFallDraft())).rejects.toThrow(/不要直接再存一次/);
  });
});

describe('retracting one', () => {
  it('encodes the id into the path and expects no body', async () => {
    apiRequest.mockResolvedValue(null);
    await deleteFall('a b/c');
    expect(apiRequest.mock.calls[0][0]).toBe('/profiles/me/falls/a%20b%2Fc');
    expect(apiRequest.mock.calls[0][1]).toEqual({ method: 'DELETE' });
  });
});

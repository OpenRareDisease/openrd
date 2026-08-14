import { describe, expect, it } from 'vitest';

import {
  applyAdminBaselineWrite,
  applyPatientBaselineWrite,
  BASELINE_PROVENANCE_KEY,
  listBaselineFieldOrigins,
  readBaselineFieldOrigin,
} from './baseline-provenance.js';
import { baselineProfileSchema } from './profile.schema.js';
import { AppError } from '../../utils/app-error.js';

const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
const OTHER_ADMIN_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const AT = new Date('2026-08-13T04:11:07.912Z');

const baseline = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  foundation: { fullName: '张三', regionLabel: '广东 广州' },
  currentStatus: { footDrop: true, assistiveDevices: ['手杖'] },
  ...over,
});

const block = (payload: Record<string, unknown>) =>
  payload[BASELINE_PROVENANCE_KEY] as Record<string, unknown> | undefined;

describe('applyAdminBaselineWrite', () => {
  it('marks only the fields the write actually changed', () => {
    const previous = baseline();
    const next = baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } });

    const stored = applyAdminBaselineWrite(previous, next, { adminUserId: ADMIN_ID, at: AT });

    expect(block(stored)).toEqual({
      'foundation.regionLabel': {
        source: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: '2026-08-13T04:11:07.912Z',
      },
    });
    expect(readBaselineFieldOrigin(stored, 'foundation.fullName')).toEqual({ state: 'patient' });
  });

  it('marks a field an admin fills in for the first time', () => {
    const stored = applyAdminBaselineWrite(
      { foundation: { fullName: '张三' } },
      { foundation: { fullName: '张三', regionLabel: '广东 广州' } },
      { adminUserId: ADMIN_ID, at: AT },
    );

    expect(readBaselineFieldOrigin(stored, 'foundation.regionLabel')).toEqual({
      state: 'admin_entered',
      adminUserId: ADMIN_ID,
      at: '2026-08-13T04:11:07.912Z',
    });
  });

  it('compares arrays by contents, not by identity', () => {
    // The admin form posts the WHOLE baseline back, including the
    // patient-only sections it only displays. A re-save of an unchanged
    // list must therefore be seen as unchanged twice over: it must not
    // be recorded as the admin having entered it, and — since
    // `currentStatus.assistiveDevices` is not admin-writable — a
    // stringify-order diff here would refuse every ordinary save.
    const stored = applyAdminBaselineWrite(baseline(), baseline(), {
      adminUserId: ADMIN_ID,
      at: AT,
    });
    expect(stored[BASELINE_PROVENANCE_KEY]).toBeUndefined();

    const changed = applyAdminBaselineWrite(
      baseline(),
      baseline({ diseaseBackground: { d4z4: '5 个重复单元' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    expect(Object.keys(block(changed)!)).toEqual(['diseaseBackground.d4z4']);
  });

  it('does not mark a field it clears, because there is no value to attribute', () => {
    const stored = applyAdminBaselineWrite(
      baseline(),
      baseline({ foundation: { fullName: '张三', regionLabel: null } }),
      { adminUserId: ADMIN_ID, at: AT },
    );

    expect(stored[BASELINE_PROVENANCE_KEY]).toBeUndefined();
  });

  it('drops an existing marker when a later admin write clears that field', () => {
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    const cleared = applyAdminBaselineWrite(
      marked,
      baseline({ foundation: { fullName: '张三' } }),
      { adminUserId: OTHER_ADMIN_ID, at: AT },
    );

    expect(cleared[BASELINE_PROVENANCE_KEY]).toBeUndefined();
  });

  it('leaves another administrator’s markers alone', () => {
    const first = applyAdminBaselineWrite(
      baseline(),
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    const second = applyAdminBaselineWrite(
      first,
      baseline({
        foundation: { fullName: '张三', regionLabel: '广东 深圳' },
        diseaseBackground: { onsetRegion: '肩带' },
      }),
      { adminUserId: OTHER_ADMIN_ID, at: AT },
    );

    expect(readBaselineFieldOrigin(second, 'foundation.regionLabel')).toMatchObject({
      adminUserId: ADMIN_ID,
    });
    expect(readBaselineFieldOrigin(second, 'diseaseBackground.onsetRegion')).toMatchObject({
      adminUserId: OTHER_ADMIN_ID,
    });
  });

  it('refuses a write that changes a field the patient answers about their own body', () => {
    // §10（四）of the privacy policy: 「你对自己身体的那些回答——诊断进展、
    // 能不能独立行走、各项困难评分——后台只能看，不能替你填。」 The admin
    // endpoint parses the FULL baselineProfileSchema, so this refusal is
    // the only thing that sentence rests on. Without it the boundary is
    // whichever text boxes the back office happens to render.
    expect(() =>
      applyAdminBaselineWrite(
        baseline(),
        baseline({ currentStatus: { footDrop: false, assistiveDevices: ['手杖'] } }),
        { adminUserId: ADMIN_ID, at: AT },
      ),
    ).toThrow(/足下垂|currentStatus\.footDrop/);

    expect(() =>
      applyAdminBaselineWrite(baseline(), baseline({ currentChallenges: { pain: 3 } }), {
        adminUserId: ADMIN_ID,
        at: AT,
      }),
    ).toThrow(/currentChallenges\.pain/);

    expect(() =>
      applyAdminBaselineWrite(
        baseline({ diseaseBackground: { diagnosisLadder: 'clinical_only' } }),
        baseline({ diseaseBackground: { diagnosisLadder: 'genetically_confirmed' } }),
        { adminUserId: ADMIN_ID, at: AT },
      ),
    ).toThrow(/diseaseBackground\.diagnosisLadder/);
  });

  it('refuses with a 400 and names every offending field, and writes nothing', () => {
    // A 500 would tell the operator our route is broken when in fact
    // their edit was the thing we refuse; and a partial application
    // would leave half a write behind under an administrator's name.
    let thrown: unknown;
    try {
      applyAdminBaselineWrite(
        baseline(),
        baseline({
          foundation: { fullName: '李四', regionLabel: '广东 广州' },
          currentStatus: { footDrop: false, assistiveDevices: ['手杖'] },
          currentChallenges: { pain: 3 },
        }),
        { adminUserId: ADMIN_ID, at: AT },
      );
    } catch (caught) {
      thrown = caught;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).statusCode).toBe(400);
    expect((thrown as AppError).details).toEqual({
      fields: ['currentChallenges.pain', 'currentStatus.footDrop'],
    });
  });

  it('lets an admin clear a field they may write, and drops its marker', () => {
    // The decision recorded in WHAT CLEARING A FIELD MEANS: a cleared
    // field has no value, so it gets no marker and loses the one it
    // had. The three strings on the back-office screen say exactly this
    // — see apps/mobile/screens/p-admin/patient-record.tsx.
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    expect(readBaselineFieldOrigin(marked, 'foundation.regionLabel')).toMatchObject({
      state: 'admin_entered',
    });

    const cleared = applyAdminBaselineWrite(
      marked,
      baseline({ foundation: { fullName: '张三', regionLabel: null } }),
      { adminUserId: OTHER_ADMIN_ID, at: AT },
    );
    expect(readBaselineFieldOrigin(cleared, 'foundation.regionLabel')).toEqual({
      state: 'patient',
    });
  });

  it('refuses an adminUserId that is not a user id', () => {
    // A marker naming an administrator nobody can resolve looks like an
    // answer and is not one.
    expect(() =>
      applyAdminBaselineWrite(baseline(), baseline({ notes: 'x' }), { adminUserId: 'ops-team' }),
    ).toThrow(/app_users\.id/);
  });

  it('does not mutate the payloads it was given', () => {
    const previous = baseline();
    const next = baseline({ notes: '电话里说的' });
    applyAdminBaselineWrite(previous, next, { adminUserId: ADMIN_ID, at: AT });

    expect(previous[BASELINE_PROVENANCE_KEY]).toBeUndefined();
    expect(next[BASELINE_PROVENANCE_KEY]).toBeUndefined();
  });
});

describe('applyPatientBaselineWrite', () => {
  it('carries the block forward when the patient saves an untouched form', () => {
    // The form posts the whole baseline on every save, so this is the
    // ordinary case and it must not release anything: looking at a
    // value is not entering it.
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    const resaved = applyPatientBaselineWrite(
      marked,
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } }),
    );

    expect(readBaselineFieldOrigin(resaved, 'foundation.regionLabel')).toMatchObject({
      state: 'admin_entered',
    });
  });

  it('gives the field back to the patient when they change it', () => {
    // §B3: 「患者自己后续再改同一个字段时，标记回到本人填写」.
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 深圳' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    const edited = applyPatientBaselineWrite(
      marked,
      baseline({ foundation: { fullName: '张三', regionLabel: '广东 佛山' } }),
    );

    expect(edited[BASELINE_PROVENANCE_KEY]).toBeUndefined();
    expect(readBaselineFieldOrigin(edited, 'foundation.regionLabel')).toEqual({ state: 'patient' });
  });

  it('releases only the field the patient changed', () => {
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({
        foundation: { fullName: '张三', regionLabel: '广东 深圳' },
        diseaseBackground: { onsetRegion: '肩带' },
      }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    expect(Object.keys(block(marked)!).sort()).toEqual([
      'diseaseBackground.onsetRegion',
      'foundation.regionLabel',
    ]);

    const edited = applyPatientBaselineWrite(
      marked,
      baseline({
        foundation: { fullName: '张三', regionLabel: '广东 佛山' },
        diseaseBackground: { onsetRegion: '肩带' },
      }),
    );

    expect(Object.keys(block(edited)!)).toEqual(['diseaseBackground.onsetRegion']);
  });

  it('releases a field whose whole section an older client did not send', () => {
    // The web export is cached in WeChat's browser for days, so a
    // handset running the previous build posts a baseline without
    // `currentStatus` at all. The value it marked is gone; the marker
    // must go with it rather than describe a field that is not there.
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({ diseaseBackground: { onsetRegion: '肩带' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    const edited = applyPatientBaselineWrite(marked, { foundation: { fullName: '张三' } });

    expect(edited[BASELINE_PROVENANCE_KEY]).toBeUndefined();
  });

  it('does not mutate the payloads it was given', () => {
    const marked = applyAdminBaselineWrite(baseline(), baseline({ notes: '电话里说的' }), {
      adminUserId: ADMIN_ID,
      at: AT,
    });
    const next = baseline({ notes: '电话里说的' });
    applyPatientBaselineWrite(marked, next);

    expect(next[BASELINE_PROVENANCE_KEY]).toBeUndefined();
    expect(block(marked)).toEqual({
      notes: { source: 'admin_entered', adminUserId: ADMIN_ID, at: '2026-08-13T04:11:07.912Z' },
    });
  });
});

describe('readBaselineFieldOrigin', () => {
  it('reads an unmarked field, an unmarked profile and a null payload as the patient’s', () => {
    expect(readBaselineFieldOrigin(baseline(), 'foundation.fullName')).toEqual({
      state: 'patient',
    });
    expect(readBaselineFieldOrigin(null, 'foundation.fullName')).toEqual({ state: 'patient' });
    expect(readBaselineFieldOrigin('not a payload', 'foundation.fullName')).toEqual({
      state: 'patient',
    });
  });

  it('reports a malformed entry as unreadable and NEVER as the patient’s', () => {
    // The whole reason the return type is a union. A hand-written
    // UPDATE, or a half-applied future shape, must not be able to make
    // an admin-entered value render as 「本人填写」.
    for (const entry of [
      'admin',
      42,
      null,
      [],
      { source: 'clinician_entered', adminUserId: ADMIN_ID, at: AT.toISOString() },
      { source: 'admin_entered', adminUserId: 'ops-team', at: AT.toISOString() },
      { source: 'admin_entered', adminUserId: ADMIN_ID, at: 'last tuesday' },
      { source: 'admin_entered', adminUserId: ADMIN_ID },
    ]) {
      const payload = baseline({ [BASELINE_PROVENANCE_KEY]: { 'foundation.fullName': entry } });
      expect(
        readBaselineFieldOrigin(payload, 'foundation.fullName').state,
        JSON.stringify(entry),
      ).toBe('unreadable');
    }
  });

  it('reads a block that is not an object as no block at all', () => {
    const payload = baseline({ [BASELINE_PROVENANCE_KEY]: 'nonsense' });
    expect(readBaselineFieldOrigin(payload, 'foundation.fullName')).toEqual({ state: 'patient' });
  });
});

describe('listBaselineFieldOrigins', () => {
  it('lists every marked field, sorted, and nothing else', () => {
    const marked = applyAdminBaselineWrite(
      baseline(),
      baseline({
        foundation: { fullName: '李四', regionLabel: '广东 深圳' },
        notes: '电话里说的',
      }),
      { adminUserId: ADMIN_ID, at: AT },
    );

    // `currentStatus` is byte-identical in both payloads, so it is not
    // in the list: the admin did not enter it.
    expect(listBaselineFieldOrigins(marked).map((row) => row.path)).toEqual([
      'foundation.fullName',
      'foundation.regionLabel',
      'notes',
    ]);
    expect(listBaselineFieldOrigins(baseline())).toEqual([]);
  });

  it('surfaces an unreadable entry rather than dropping it from the list', () => {
    const payload = baseline({
      [BASELINE_PROVENANCE_KEY]: { 'foundation.fullName': { source: 'nope' } },
    });
    expect(listBaselineFieldOrigins(payload)).toEqual([
      { path: 'foundation.fullName', origin: { state: 'unreadable', detail: expect.any(String) } },
    ]);
  });
});

describe('the hazard these helpers exist to work around', () => {
  it('baselineProfileSchema strips the provenance block, so a write path that skips the helpers erases it', () => {
    // Asserted rather than asserted-in-a-comment. If Zod's stripping
    // behaviour or the schema's shape ever changes, this test says so,
    // and the paragraph at the top of baseline-provenance.ts stops
    // being true.
    const marked = applyAdminBaselineWrite(baseline(), baseline({ notes: '电话里说的' }), {
      adminUserId: ADMIN_ID,
      at: AT,
    });
    expect(marked[BASELINE_PROVENANCE_KEY]).toBeDefined();

    const parsed = baselineProfileSchema.parse(marked) as Record<string, unknown>;
    expect(parsed[BASELINE_PROVENANCE_KEY]).toBeUndefined();
  });
});

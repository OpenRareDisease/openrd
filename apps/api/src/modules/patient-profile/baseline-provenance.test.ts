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
      baseline({ diseaseBackground: { onsetRegion: '肩带' } }),
      { adminUserId: ADMIN_ID, at: AT },
    );
    expect(Object.keys(block(changed)!)).toEqual(['diseaseBackground.onsetRegion']);
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
    ).toThrow(/足下垂/);

    expect(() =>
      applyAdminBaselineWrite(baseline(), baseline({ currentChallenges: { pain: 3 } }), {
        adminUserId: ADMIN_ID,
        at: AT,
      }),
    ).toThrow(/疼痛/);

    expect(() =>
      applyAdminBaselineWrite(
        baseline({ diseaseBackground: { diagnosisLadder: 'clinical_only' } }),
        baseline({ diseaseBackground: { diagnosisLadder: 'genetically_confirmed' } }),
        { adminUserId: ADMIN_ID, at: AT },
      ),
    ).toThrow(/诊断进展/);
  });

  it('refuses a write that changes a genetic result, and names it in Chinese', () => {
    // A genetic result is a laboratory measurement. Dictated over a
    // phone call it arrives here as a number that reads like one and is
    // not, and nothing downstream can tell the difference. The operator
    // has to be told which field they may not fill in, in the words
    // their own screen uses for it.
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ diagnosisType: 'FSHD1' }, /FSHD 分型/],
      [{ d4z4: '4/22' }, /D4Z4 重复数/],
      [{ haplotype: '4qA' }, /单倍型/],
      [{ methylation: '12%' }, /甲基化/],
    ];
    for (const [diseaseBackground, named] of cases) {
      expect(() =>
        applyAdminBaselineWrite(baseline(), baseline({ diseaseBackground }), {
          adminUserId: ADMIN_ID,
          at: AT,
        }),
      ).toThrow(named);
    }

    // And a genetic value the read-time autofill supplied, echoed back
    // in an otherwise ordinary save, is refused the same way: the whole
    // baseline goes on the wire, so this is what an administrator
    // editing 备注 on an autofilled payload actually sends.
    let thrown: unknown;
    try {
      applyAdminBaselineWrite(
        baseline(),
        baseline({ diseaseBackground: { d4z4: '4/22' }, notes: '电话里说的' }),
        { adminUserId: ADMIN_ID, at: AT },
      );
    } catch (caught) {
      thrown = caught;
    }
    expect((thrown as AppError).statusCode).toBe(400);
    expect((thrown as AppError).message).toContain('D4Z4 重复数');
    // The reason has to be the one that applies. An operator reading a
    // laboratory report, told a D4Z4 is 「患者对自己身体的回答」, would
    // take the refusal for a bug.
    expect((thrown as AppError).message).not.toContain('患者对自己身体的回答');
    expect((thrown as AppError).message).toContain('基因报告');
  });

  it('gives each refused field the reason that applies to it, in one message', () => {
    let thrown: unknown;
    try {
      applyAdminBaselineWrite(
        baseline(),
        baseline({
          diseaseBackground: { d4z4: '4/22' },
          currentChallenges: { pain: 3 },
        }),
        { adminUserId: ADMIN_ID, at: AT },
      );
    } catch (caught) {
      thrown = caught;
    }

    const message = (thrown as AppError).message;
    // Two refusals for two different reasons, and the operator has to
    // be able to tell which field each reason is about.
    expect(message).toMatch(/基因结果：D4Z4 重复数/);
    expect(message).toMatch(/不能代填这些字段：疼痛/);
  });

  it('carries a stored marker forward on a field the allowlist does not admit', () => {
    // Profiles carry such markers, and the value they describe is still
    // in the column. An admin write that touches something else must
    // neither refuse (nothing changed there) nor drop the entry (the
    // value it describes is still there).
    const previous = baseline({
      diseaseBackground: { d4z4: '4/22' },
      [BASELINE_PROVENANCE_KEY]: {
        'diseaseBackground.d4z4': {
          source: 'admin_entered',
          adminUserId: ADMIN_ID,
          at: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    const stored = applyAdminBaselineWrite(
      previous,
      baseline({ diseaseBackground: { d4z4: '4/22' }, notes: '电话里说的' }),
      { adminUserId: OTHER_ADMIN_ID, at: AT },
    );

    expect(readBaselineFieldOrigin(stored, 'diseaseBackground.d4z4')).toEqual({
      state: 'admin_entered',
      adminUserId: ADMIN_ID,
      at: '2026-01-01T00:00:00.000Z',
    });
    // And it is still in the list every §B3 surface renders from.
    expect(listBaselineFieldOrigins(stored).map((row) => row.path)).toEqual([
      'diseaseBackground.d4z4',
      'notes',
    ]);
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
    // The message is the only thing that reaches the operator — the
    // error handler's CLIENT_SAFE_DETAIL_KEYS drops any `details`
    // payload this throw could attach — so both offending fields have
    // to be in it, named the way the back office names them rather
    // than by their dotted paths.
    expect((thrown as AppError).message).toContain('疼痛');
    expect((thrown as AppError).message).toContain('足下垂');
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

  /**
   * A FIELD EMPTIED IS A FIELD CLEARED, whichever of the three ways the
   * HTTP surface says it.
   *
   * `null` is what the shipped back-office screen sends, so every test
   * above passed while the endpoint accepted an empty string from any
   * other client and stored it WITH a fresh 管理员代填 marker on it.
   * That marker then travels: the record endpoint's `fieldOrigins`, the
   * back-office row, the `admin_entered_baseline_fields` CSV column and
   * the portable exports' envelope, each telling a reader — a receiving
   * registry, in the last case — a provenance fact about a value that
   * is not there. Whitespace is the same case one step earlier:
   * `nullableText` is `z.string().trim()`, so 「   」 arrives as ''.
   */
  describe('clearing a field', () => {
    const CLEARED = [
      ['null', null],
      ['an empty string', ''],
      ['a string of spaces, which the schema has already trimmed to empty', '   '],
      ['a whitespace-only string the schema did not trim', '　\t '],
    ] as const;

    it.each(CLEARED)('adds no marker when the value written is %s', (_label, value) => {
      const stored = applyAdminBaselineWrite(
        baseline(),
        baseline({ foundation: { fullName: '张三', regionLabel: value } }),
        { adminUserId: ADMIN_ID, at: AT },
      );

      expect(readBaselineFieldOrigin(stored, 'foundation.regionLabel')).toEqual({
        state: 'patient',
      });
      expect(stored[BASELINE_PROVENANCE_KEY]).toBeUndefined();
    });

    it.each(CLEARED)('drops an existing marker when the value written is %s', (_label, value) => {
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
        baseline({ foundation: { fullName: '张三', regionLabel: value } }),
        { adminUserId: OTHER_ADMIN_ID, at: AT },
      );

      expect(readBaselineFieldOrigin(cleared, 'foundation.regionLabel')).toEqual({
        state: 'patient',
      });
    });

    /**
     * THE ERASE IS STILL A CHANGE. `isClearedValue` decides what happens
     * to the marker and nothing else — emptying a box the allowlist does
     * not admit has to stay a refusal, or an operator would have found
     * the way to delete a laboratory result by selecting it and pressing
     * backspace.
     */
    it('is still a write, so clearing a field an admin may not write is refused', () => {
      for (const value of ['', '   ', null]) {
        expect(() =>
          applyAdminBaselineWrite(
            { diseaseBackground: { d4z4: '7' } },
            { diseaseBackground: { d4z4: value } },
            { adminUserId: ADMIN_ID, at: AT },
          ),
        ).toThrow(AppError);
      }
    });

    it('leaves 0 and false alone, because they are answers', () => {
      const stored = applyAdminBaselineWrite(
        { foundation: { fullName: '张三', birthYear: 1990 } },
        { foundation: { fullName: '张三', birthYear: 0 } },
        { adminUserId: ADMIN_ID, at: AT },
      );

      expect(readBaselineFieldOrigin(stored, 'foundation.birthYear')).toMatchObject({
        state: 'admin_entered',
      });
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

  /**
   * The two helpers have to agree on what an empty field is, or the
   * patient's save becomes a way of preserving a marker over nothing.
   * Only a hand-written UPDATE can put the profile in this state now —
   * `applyAdminBaselineWrite` no longer creates it — which is exactly
   * why the drop has to be unconditional here rather than relying on
   * the other helper having been the last writer.
   */
  it('drops a marker standing over a value that is present and empty', () => {
    const handEdited = {
      foundation: { fullName: '张三', regionLabel: '' },
      currentStatus: { footDrop: true, assistiveDevices: ['手杖'] },
      [BASELINE_PROVENANCE_KEY]: {
        'foundation.regionLabel': {
          source: 'admin_entered',
          adminUserId: ADMIN_ID,
          at: '2026-01-01T00:00:00.000Z',
        },
      },
    };

    const resaved = applyPatientBaselineWrite(
      handEdited,
      baseline({ foundation: { fullName: '张三', regionLabel: '' } }),
    );

    expect(resaved[BASELINE_PROVENANCE_KEY]).toBeUndefined();
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

  it('releases a stored marker on a field the allowlist does not admit', () => {
    // The way such a marker leaves. The patient's write has no
    // allowlist — they answer for themselves — so a value they correct
    // in their own app comes back to them, whatever the back office may
    // type.
    const marked = baseline({
      diseaseBackground: { d4z4: '4/22' },
      [BASELINE_PROVENANCE_KEY]: {
        'diseaseBackground.d4z4': {
          source: 'admin_entered',
          adminUserId: ADMIN_ID,
          at: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    const edited = applyPatientBaselineWrite(
      marked,
      baseline({ diseaseBackground: { d4z4: '3/22' } }),
    );

    expect(readBaselineFieldOrigin(edited, 'diseaseBackground.d4z4')).toEqual({ state: 'patient' });
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

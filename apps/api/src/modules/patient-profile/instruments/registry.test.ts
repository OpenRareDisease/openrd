import { describe, expect, it } from 'vitest';

import {
  CURRENT_INSTRUMENTS,
  INSTRUMENT_KEYS,
  allInstrumentDefinitions,
  findCurrentInstrument,
  findInstrumentVersion,
} from './registry.js';

describe('instrument registry', () => {
  it('ships the two instruments this round promised', () => {
    expect(INSTRUMENT_KEYS.slice().sort()).toEqual([
      'brooke_upper_extremity',
      'vignos_lower_extremity',
    ]);
  });

  it('resolves an exact (key, version) pair', () => {
    const definition = findInstrumentVersion('brooke_upper_extremity', 'v1');
    expect(definition?.nameZh).toBe('Brooke 上肢功能分级');
  });

  it('does not resolve a version it does not have', () => {
    // The point of versioned lookup: a row written by a newer deploy
    // must read back as "unknown version", never as the current one.
    expect(findInstrumentVersion('brooke_upper_extremity', 'v2')).toBeNull();
    expect(findInstrumentVersion('nonexistent', 'v1')).toBeNull();
  });

  it('has exactly one current version per key', () => {
    // Two current versions of one key would make "which wording did
    // the patient answer" depend on map iteration order.
    const keys = CURRENT_INSTRUMENTS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exposes every current instrument through findCurrentInstrument', () => {
    for (const key of INSTRUMENT_KEYS) {
      expect(findCurrentInstrument(key)?.key).toBe(key);
    }
    expect(findCurrentInstrument('not_a_scale')).toBeNull();
  });
});

describe('every instrument definition is internally consistent', () => {
  it.each(allInstrumentDefinitions().map((definition) => [definition.key, definition] as const))(
    '%s',
    (_key, definition) => {
      expect(definition.items.length).toBeGreaterThan(0);

      for (const item of definition.items) {
        // No duplicate level values: two anchors sharing a value means
        // one of them can never be selected and the label resolution
        // picks whichever comes first.
        const values = item.levels.map((level) => level.value);
        expect(new Set(values).size).toBe(values.length);

        for (const level of item.levels) {
          // The declared score range must actually contain every
          // level. A level outside it is a grade the scorer accepts
          // and the chart axis cannot draw.
          expect(level.value).toBeGreaterThanOrEqual(definition.scoreMin);
          expect(level.value).toBeLessThanOrEqual(definition.scoreMax);
          // Every Chinese anchor keeps the English it was translated
          // from, right next to it. A translation whose source is not
          // beside it is one nobody can check.
          expect(level.sourceEn.trim().length).toBeGreaterThan(0);
          expect(level.labelZh.trim().length).toBeGreaterThan(0);
        }
      }

      // Provenance and honesty are not optional fields.
      expect(definition.sourceCitation.trim().length).toBeGreaterThan(0);
      expect(definition.selfReportEvidenceZh.trim().length).toBeGreaterThan(0);
      expect(definition.limitationsZh.length).toBeGreaterThan(0);
      // 'unknown' licence means we cannot show it to a patient yet.
      expect(definition.licenceStatus).not.toBe('unknown');
      expect(definition.licenceStatus).not.toBe('permission_required');
    },
  );

  it('gives every instrument a distinct scoring method name', () => {
    // The method name is what a re-scoring pass selects on. Two
    // instruments sharing one would re-score both together.
    const methods = allInstrumentDefinitions().map((definition) => definition.scoringMethod);
    expect(new Set(methods).size).toBe(methods.length);
  });

  it('names the scoring method that the score function actually stamps', () => {
    for (const definition of allInstrumentDefinitions()) {
      const item = definition.items[0];
      const outcome = definition.score([
        {
          itemCode: item.code,
          responseValue: item.levels[0].value,
          skipped: false,
          notApplicable: false,
        },
      ]);
      expect(outcome.ok).toBe(true);
      expect(outcome.ok === true && outcome.score.scoringMethod).toBe(definition.scoringMethod);
    }
  });
});

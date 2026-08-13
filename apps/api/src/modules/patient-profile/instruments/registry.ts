import { brookeUpperExtremityV1 } from './brooke.js';
import type { InstrumentDefinition } from './instrument.types.js';
import { vignosLowerExtremityV1 } from './vignos.js';

/**
 * The instrument registry.
 *
 * Every definition the API will score against, keyed by
 * "key@version". Versioned lookup is the point: an administration
 * stored last year names the version it was answered against, and
 * re-reading it must resolve to THAT definition, not to whatever is
 * current. A registry keyed by `key` alone would silently re-interpret
 * history the first time an anchor was reworded, which is the exact
 * failure the freeze comments in brooke.ts / vignos.ts exist to
 * prevent.
 *
 * `CURRENT_INSTRUMENTS` is the separate, smaller question of what a
 * patient may be offered TODAY. New administrations may only be
 * recorded against a current version; old ones stay readable forever.
 */

const definitionKey = (key: string, version: string) => key + '@' + version;

const ALL_DEFINITIONS: readonly InstrumentDefinition[] = [
  brookeUpperExtremityV1,
  vignosLowerExtremityV1,
];

const BY_KEY_VERSION = new Map<string, InstrumentDefinition>(
  ALL_DEFINITIONS.map((definition) => [
    definitionKey(definition.key, definition.version),
    definition,
  ]),
);

/**
 * The version a NEW administration is recorded against, per instrument
 * key. Exactly one current version per key; a second entry for the
 * same key would make "which one did the patient answer" depend on map
 * iteration order.
 */
const CURRENT_BY_KEY = new Map<string, InstrumentDefinition>(
  ALL_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export const CURRENT_INSTRUMENTS: readonly InstrumentDefinition[] = Array.from(
  CURRENT_BY_KEY.values(),
);

export const INSTRUMENT_KEYS = CURRENT_INSTRUMENTS.map((definition) => definition.key) as [
  string,
  ...string[],
];

/** Resolve an exact (key, version). Used when re-reading stored rows. */
export const findInstrumentVersion = (key: string, version: string): InstrumentDefinition | null =>
  BY_KEY_VERSION.get(definitionKey(key, version)) ?? null;

/** Resolve the version a new administration should be scored against. */
export const findCurrentInstrument = (key: string): InstrumentDefinition | null =>
  CURRENT_BY_KEY.get(key) ?? null;

/** Every definition, current and historical. The catalogue endpoint
 *  serves only current ones; this is for re-scoring passes and tests. */
export const allInstrumentDefinitions = (): readonly InstrumentDefinition[] => ALL_DEFINITIONS;

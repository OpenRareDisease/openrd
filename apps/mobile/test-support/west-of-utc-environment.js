const RealEnvironment = require('react-native/jest/react-native-env');

/**
 * A jest environment pinned to a timezone WEST of Greenwich.
 *
 * Every date-only defect this file exists to catch is invisible in
 * China (UTC+8): `new Date('2025-05-09')` is UTC midnight, and reading
 * it back with `getDate()` only moves the day backwards when the
 * reader is west of UTC. Running the suite in the product's own
 * timezone would never have shown that the exported passport PDF
 * printed 05-08 for a report the API dated 05-09.
 *
 * It has to be an environment rather than a `process.env.TZ = ...`
 * inside the test: jest's sandbox gets a copy of `process`, and V8 has
 * already cached the zone by the time a test body runs, so assigning
 * TZ from inside a test changes the string and nothing else. The
 * environment constructor runs in the runner's own realm, before the
 * sandbox context exists, where the assignment still reaches the real
 * setter.
 */
class WestOfUtcEnvironment extends RealEnvironment {
  constructor(config, context) {
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    super(config, context);
    this.previousTimezone = previous;
  }

  async teardown() {
    await super.teardown();
    if (this.previousTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = this.previousTimezone;
    }
  }
}

module.exports = WestOfUtcEnvironment;

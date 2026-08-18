const RealEnvironment = require('react-native/jest/react-native-env');

/**
 * A jest environment pinned to the PRODUCT's own timezone.
 *
 * The sibling `west-of-utc-environment.js` exists to expose the day a
 * device west of Greenwich loses. This one is its other half: the same
 * suite has to give the SAME answer on a handset in Shanghai, which is
 * where almost every one of these patients actually is. A formatter
 * that is correct only in Los Angeles is no better than one that is
 * correct only in Beijing — the assertion both files share is that the
 * printed sheet does not depend on where the phone is.
 *
 * Same mechanism as the sibling, and for the same reason: jest's
 * sandbox gets a copy of `process`, and V8 has already cached the zone
 * by the time a test body runs, so `process.env.TZ = ...` inside a test
 * changes the string and nothing else. The environment constructor runs
 * in the runner's own realm, where the assignment still reaches the
 * real setter.
 */
class ProductTimezoneEnvironment extends RealEnvironment {
  constructor(config, context) {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
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

module.exports = ProductTimezoneEnvironment;

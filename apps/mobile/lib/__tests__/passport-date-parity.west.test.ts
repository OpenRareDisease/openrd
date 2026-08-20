/**
 * @jest-environment ./test-support/west-of-utc-environment.js
 */

/**
 * The same parity assertions, same constants, on a handset west of
 * Greenwich — a patient who has travelled, a maintainer's laptop, a CI
 * box. Two runs that each pin the document to the SAME strings are what
 * makes 「这张纸上的日期不取决于手机在哪儿」 a measured claim rather
 * than a hope. See test-support/passport-date-parity-suite.ts.
 */

// The PDF builder reaches AsyncStorage through api.ts → session-storage,
// and that has no native module under jest. Same stub the sibling
// suites use.
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { runPassportDateParitySuite } from '../../test-support/passport-date-parity-suite';

runPassportDateParitySuite('America/Los_Angeles');

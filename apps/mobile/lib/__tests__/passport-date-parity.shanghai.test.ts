/**
 * @jest-environment ./test-support/product-timezone-environment.js
 */

/**
 * The parity suite on a handset in the product's own timezone — where
 * almost every one of these patients actually is, and the zone in which
 * a formatter that reads the ambient clock looks correct by accident.
 * The west-of-UTC run of the SAME assertions is the other half; see
 * test-support/passport-date-parity-suite.ts.
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

runPassportDateParitySuite('Asia/Shanghai');

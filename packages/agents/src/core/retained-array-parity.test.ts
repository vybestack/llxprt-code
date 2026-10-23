/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  registerRetainedParityCases,
  RETAINED_PARITY_STAGES,
} from './__tests__/support/client-array-parity-cases.js';

// Each 8192-row stage has its own file to keep the unchanged operation and
// assertions within the runner's per-file budget.
registerRetainedParityCases([512], RETAINED_PARITY_STAGES);

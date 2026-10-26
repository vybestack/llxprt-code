/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  registerRetainedParityCases,
  RETAINED_PARITY_STAGES,
} from './__tests__/support/client-array-parity-cases.js';

registerRetainedParityCases([65], RETAINED_PARITY_STAGES);
registerRetainedParityCases([8192], ['success']);

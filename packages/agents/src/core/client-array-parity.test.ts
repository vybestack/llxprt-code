/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  PARITY_STAGES,
  registerParityCases,
} from './__tests__/support/client-array-parity-cases.js';

registerParityCases([65], PARITY_STAGES);
registerParityCases([8192], ['success']);

/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { registerRetainedBoundaryCases } from './__tests__/support/retained-array-boundary-cases.js';

registerRetainedBoundaryCases([512], ['pending', 'abort', 'participant']);

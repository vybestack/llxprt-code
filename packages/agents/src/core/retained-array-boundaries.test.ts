/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  registerRetainedBoundaryCases,
  registerRetainedParticipantControl,
} from './__tests__/support/retained-array-boundary-cases.js';

registerRetainedBoundaryCases([65], ['pending', 'abort', 'participant']);

registerRetainedParticipantControl();

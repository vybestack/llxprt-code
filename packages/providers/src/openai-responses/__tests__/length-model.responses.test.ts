/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: over the frozen Responses corpus of the native provider
 * (5,000 seeds, raw and normalized rows), the length the transducer predicts
 * from per-unit facts equals the byte length of the `input` array that
 * today's builders wrote. Composition is associative at every split point,
 * and the design-7.3 pair shortcut is wrong.
 */

import { defineResponsesFrozenTests } from './support/lengthModel/responsesFrozenTestKit.js';

defineResponsesFrozenTests('openai-responses');

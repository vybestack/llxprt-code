/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the same check over the frozen corpus of the Responses
 * route of the OpenAI provider.
 */

import { defineResponsesFrozenTests } from './support/lengthModel/responsesFrozenTestKit.js';

defineResponsesFrozenTests('openai-responses-via-openai');

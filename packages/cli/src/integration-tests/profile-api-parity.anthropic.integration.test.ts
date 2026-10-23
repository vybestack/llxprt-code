/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from 'bun:test';
import {
  anthropicParity,
  installParityFixture,
  parityDescription,
  registerApiProviderCases,
} from './profile-parity-harness.js';

describe(`${parityDescription}: anthropic API credentials`, () => {
  const fixture = installParityFixture();
  registerApiProviderCases(fixture, anthropicParity);
});

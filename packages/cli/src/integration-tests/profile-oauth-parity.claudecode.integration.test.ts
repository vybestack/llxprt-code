/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from 'bun:test';
import {
  claudecodeParity,
  installParityFixture,
  parityDescription,
  registerOAuthProviderCases,
} from './profile-parity-harness.js';

describe(`${parityDescription}: claudecode OAuth`, () => {
  const fixture = installParityFixture();
  registerOAuthProviderCases(fixture, claudecodeParity);
});

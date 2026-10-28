/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from 'bun:test';
import {
  codexParity,
  installParityFixture,
  parityDescription,
  registerOAuthProviderCases,
} from './profile-parity-harness.js';

describe(`${parityDescription}: codex OAuth`, () => {
  const fixture = installParityFixture();
  registerOAuthProviderCases(fixture, codexParity);
});

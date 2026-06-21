/**
 * @plan:PLAN-20260603-ISSUE1584.P06
 * @requirement:REQ-PKG-001
 * @pseudocode lines 13-14
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { setProviderRuntimeStateFactory } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

// Provider package tests include legacy runtime-context helpers that create a
// runtime before registering a SettingsService singleton. Provide an isolated
// default settings state for those test-only contexts.
setProviderRuntimeStateFactory(() => new SettingsService());

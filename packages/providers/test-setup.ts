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

import { vi } from 'vitest';
import { createRequire } from 'node:module';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { setProviderRuntimeStateFactory } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

// Add vi.importActualSync for Bun-compatible sync mock factory patterns.
// Under Vitest this uses createRequire to load the actual module (bypassing
// vi.mock interception). Under Bun it is provided by augment-bun-vi.ts.
const req = createRequire(import.meta.url);
(
  vi as unknown as { importActualSync: (id: string) => unknown }
).importActualSync = (id: string) => req(id);

// Provider package tests include legacy runtime-context helpers that create a
// runtime before registering a SettingsService singleton. Provide an isolated
// default settings state for those test-only contexts.
setProviderRuntimeStateFactory(() => new SettingsService());

// Clear credential-proxy env vars so unit tests don't inherit the host
// process's proxy configuration (which would skip proactive renewal scheduling
// and alter token-store behaviour).
delete process.env.LLXPRT_CREDENTIAL_SOCKET;
delete process.env.LLXPRT_CAPABILITY_TOKEN;
delete process.env.LLXPRT_CAPABILITY_FD;

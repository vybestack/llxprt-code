/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Full React/Ink test setup, composed over the node-safe base layer.
 *
 * The base setup (`test-setup-base.ts`) owns NODE_ENV, storage isolation,
 * NO_COLOR removal, providerAliases mock, lazy ink stub mock, custom matchers,
 * process-listener restoration, DebugLogger reset, cleanup-state reset, and
 * provider runtime context reset. This module adds the React/global internals
 * compatibility code and ink-testing-library render cleanup that only make
 * sense when React/Ink rendering is exercised.
 */

import './test-setup-base.js';

// Clear credential-proxy env vars so unit tests don't inherit the host
// process's proxy configuration (which would skip proactive renewal
// scheduling, alter token-store behaviour, and change sandbox paths).
delete process.env.LLXPRT_CREDENTIAL_SOCKET;
delete process.env.LLXPRT_CAPABILITY_TOKEN;
delete process.env.LLXPRT_CAPABILITY_FD;

// Setup for React DOM testing - fix for React 19 internals issue
import React from 'react';
import { cleanup as cleanupInkRenders } from 'ink-testing-library';
import { afterEach } from 'vitest';

// The issue is that React DOM is trying to access ReactSharedInternals.S
// but ReactSharedInternals might be undefined or missing the S property.
// We need to ensure React's shared internals are properly initialized.

type ReactSharedInternals = {
  S?: unknown;
  T?: unknown;
  H?: unknown;
};

type ReactWithSharedInternals = typeof React & {
  _DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE?: ReactSharedInternals;
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: ReactSharedInternals;
};

type GlobalWithReactInternals = typeof globalThis & {
  React?: typeof React;
  ReactSharedInternals?: ReactSharedInternals;
};

const globalWithReact = globalThis as GlobalWithReactInternals;
globalWithReact.React = React;

// Access and initialize React's shared internals
const reactWithInternals = React as ReactWithSharedInternals;
const ReactInternals =
  reactWithInternals._DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE ??
  reactWithInternals.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
if (ReactInternals) {
  // Ensure the S property exists (used by React DOM for transition handling)
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'S')) {
    ReactInternals.S = null;
  }
  // Ensure other properties that might be missing
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'T')) {
    ReactInternals.T = null;
  }
  if (!Object.prototype.hasOwnProperty.call(ReactInternals, 'H')) {
    ReactInternals.H = null;
  }

  // Make sure ReactSharedInternals is available globally as React DOM expects it
  globalWithReact.ReactSharedInternals = ReactInternals;
}

afterEach(async () => {
  cleanupInkRenders();
  // Base cleanup is registered before this hook by test-setup-base.ts. Vitest
  // executes afterEach hooks in reverse registration order, so Ink teardown
  // completes before the shared process and runtime state are reset.
});

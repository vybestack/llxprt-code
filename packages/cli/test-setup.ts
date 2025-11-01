/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Set NODE_ENV to test if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Unset NO_COLOR environment variable to ensure consistent theme behavior between local and CI test runs
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

// Setup for React DOM testing - fix for React 19 internals issue
import React from 'react';
import { vi } from 'vitest';

vi.mock('ink', () => import('./test-utils/ink-stub.ts'), {
  virtual: true,
});

// The issue is that React DOM is trying to access ReactSharedInternals.S
// but ReactSharedInternals might be undefined or missing the S property.
// We need to ensure React's shared internals are properly initialized.

// First, ensure React is available globally
if (typeof globalThis !== 'undefined') {
  // @ts-expect-error - Necessary for React DOM compatibility in tests
  globalThis.React = React;
}

// Access and initialize React's shared internals
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ReactInternals = (React as any)
  .__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
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
  if (typeof globalThis !== 'undefined') {
    // @ts-expect-error - ReactSharedInternals global assignment for React DOM compatibility
    globalThis.ReactSharedInternals = ReactInternals;
  }
}

import './src/test-utils/customMatchers.js';

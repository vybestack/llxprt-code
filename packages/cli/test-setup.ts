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
import * as ReactDOM from 'react-dom';

// The issue is that React DOM is trying to access ReactSharedInternals.S
// but ReactSharedInternals might be undefined or missing the S property.
// We need to ensure React's shared internals are properly initialized.

// First, ensure React is available globally
if (typeof globalThis !== 'undefined') {
  // @ts-expect-error - Necessary for React DOM compatibility in tests
  globalThis.React = React;
}

type SharedInternals = Record<string, unknown> & {
  S: unknown;
  T: unknown;
  H: unknown;
};

type InternalCarrier = {
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?: SharedInternals;
};

const ensureInternals = (
  carrier: InternalCarrier,
  initializeIfMissing: boolean,
): SharedInternals | undefined => {
  let internals = carrier.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

  if (!internals) {
    if (!initializeIfMissing) {
      return undefined;
    }
    internals = {
      S: null,
      T: null,
      H: null,
    };
    carrier.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = internals;
  }

  if (internals.S === undefined) {
    internals.S = null;
  }
  if (internals.T === undefined) {
    internals.T = null;
  }
  if (internals.H === undefined) {
    internals.H = null;
  }

  return internals;
};

const reactInternals = ensureInternals(
  React as typeof React & InternalCarrier,
  true,
);
const domInternals = ensureInternals(
  ReactDOM as typeof ReactDOM & InternalCarrier,
  false,
);
const sharedInternals = reactInternals ??
  domInternals ?? {
    S: null,
    T: null,
    H: null,
  };

if (typeof globalThis !== 'undefined') {
  // @ts-expect-error - ReactSharedInternals global assignment for React DOM compatibility
  globalThis.ReactSharedInternals = sharedInternals;
}

import './src/test-utils/customMatchers.js';

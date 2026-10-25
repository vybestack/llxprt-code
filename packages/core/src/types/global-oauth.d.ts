/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Type definitions for global OAuth state variables
declare global {
  namespace NodeJS {
    interface Global {
      __oauth_needs_code?: boolean;
      __oauth_provider?: string;
    }
  }
}

export {};

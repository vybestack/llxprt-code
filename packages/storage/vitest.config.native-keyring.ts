/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/secure-store/secure-store.native-keyring.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'junit.secure-store.xml',
    },
    coverage: {
      enabled: false,
    },
  },
});

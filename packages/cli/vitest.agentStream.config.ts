/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config.ts';

export default defineConfig(
  mergeConfig(
    baseConfig,
    defineConfig({
      test: {
        include: ['src/agentStream.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**'],
      },
    }),
  ),
);

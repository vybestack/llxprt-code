/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import baseConfig from './vitest.config.ts';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      'src/ui/commands/schema/argumentResolver.test.ts',
      'src/ui/commands/test/subagentCommand.schema.test.ts',
      'src/ui/commands/test/setCommand.phase09.test.ts',
      'src/ui/commands/test/setCommand.mutation.test.ts',
    ],
    // Keep the same excludes as base config but ensure our focus files remain accessible
    exclude: baseConfig.test?.exclude,
    reporters: baseConfig.test?.reporters,
    outputFile: baseConfig.test?.outputFile,
    environment: baseConfig.test?.environment,
    globals: baseConfig.test?.globals,
    setupFiles: baseConfig.test?.setupFiles,
    poolOptions: baseConfig.test?.poolOptions,
    testTimeout: baseConfig.test?.testTimeout,
    hookTimeout: baseConfig.test?.hookTimeout,
    environmentOptions: baseConfig.test?.environmentOptions,
    coverage: {
      enabled: false,
    },
  },
});

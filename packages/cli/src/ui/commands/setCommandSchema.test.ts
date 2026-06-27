/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { buildSetSchema } from './setCommandSchema.js';
import { createCompletionHandler } from './schema/index.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

// Regression coverage for issue #1050: the four ephemeral timeout settings
// (task-default-timeout-seconds, task-max-timeout-seconds,
// shell-default-timeout-seconds, shell-max-timeout-seconds) must surface in
// /set autocomplete as kebab-case literals. These tests exercise the REAL
// /set autocomplete pipeline (registry-driven schema + public completion
// handler) rather than a synthetic schema, so they guard against the
// settings being removed, renamed back to snake_case, or recategorized into
// an autocomplete-excluded category.
describe('/set timeout settings autocomplete (issue #1050)', () => {
  const handler = createCompletionHandler(buildSetSchema());
  const ctx = createMockCommandContext();

  const collectValues = async (
    fullLine: string,
  ): Promise<readonly string[]> => {
    const result = await handler(
      ctx,
      fullLine.replace(/^\/set\s?/, ''),
      fullLine,
    );
    return result.suggestions.map((s) => s.value);
  };

  it('suggests both task timeout settings for "/set task"', async () => {
    const values = await collectValues('/set task');

    expect(values).toContain('task-default-timeout-seconds');
    expect(values).toContain('task-max-timeout-seconds');
  });

  it('suggests both shell timeout settings for "/set shell-"', async () => {
    const values = await collectValues('/set shell-');

    expect(values).toContain('shell-default-timeout-seconds');
    expect(values).toContain('shell-max-timeout-seconds');
  });

  it('suggests task-default-timeout-seconds for "/set task-default"', async () => {
    const values = await collectValues('/set task-default');

    expect(values).toContain('task-default-timeout-seconds');
  });

  it('suggests shell-max-timeout-seconds for "/set shell-max"', async () => {
    const values = await collectValues('/set shell-max');

    expect(values).toContain('shell-max-timeout-seconds');
  });

  it('includes all four timeout settings in the full "/set " suggestion list', async () => {
    const values = await collectValues('/set ');

    expect(values).toContain('task-default-timeout-seconds');
    expect(values).toContain('task-max-timeout-seconds');
    expect(values).toContain('shell-default-timeout-seconds');
    expect(values).toContain('shell-max-timeout-seconds');
  });

  it('does not expose any snake_case timeout setting names', async () => {
    const values = await collectValues('/set ');
    const snakeCaseNames = [
      'task_default_timeout_seconds',
      'task_max_timeout_seconds',
      'shell_default_timeout_seconds',
      'shell_max_timeout_seconds',
    ];

    for (const snakeCaseName of snakeCaseNames) {
      expect(values).not.toContain(snakeCaseName);
    }
  });
});

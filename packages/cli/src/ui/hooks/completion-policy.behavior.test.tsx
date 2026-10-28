/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { renderHook, waitFor } from '../../__tests__/render.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { CommandKind, type SlashCommand } from '../commands/types.js';
import { useSlashCompletion } from './useSlashCompletion.js';

describe('completion policy updates', () => {
  it('recomputes unchanged input when its owner changes filtering policy', async () => {
    const commands: SlashCommand[] = [
      {
        name: 'command',
        description: 'completion fixture',
        kind: CommandKind.BUILT_IN,
        schema: [{ kind: 'literal', value: 'production' }],
      },
    ];
    const invocation = createMockCommandContext();
    invocation.services.settings.merged.enableFuzzyFiltering = false;
    const directories: readonly string[] = [];
    const { result, rerender, unmount } = renderHook(
      ({ fuzzy }) => {
        const buffer = useTextBuffer({
          initialText: '/command prd',
          initialCursorOffset: 12,
          viewport: { width: 80, height: 20 },
          isValidPath: () => false,
          onChange: () => {},
        });
        return useSlashCompletion(
          fuzzy,
          buffer,
          directories,
          process.cwd(),
          commands,
          invocation,
          false,
        );
      },
      { initialProps: { fuzzy: true } },
    );
    try {
      await waitFor(() =>
        expect(result.current.suggestions.map((item) => item.value)).toContain(
          'production',
        ),
      );
      rerender({ fuzzy: false });
      await waitFor(() => expect(result.current.suggestions).toStrictEqual([]));
    } finally {
      unmount();
    }
  });
});

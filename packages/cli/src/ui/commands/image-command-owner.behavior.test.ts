/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createImageCommand } from './imageCommand.js';

describe('registered image command owner', () => {
  it('runs the image operation supplied by its registered owner', async () => {
    const history: Array<{ text: string }> = [];
    const command = createImageCommand({
      workspaceRoot: '/workspace/registered',
      runImageOperation: async () => ({
        absoluteOutputPath: '/workspace/registered/out.png',
      }),
      addItem: (item) => history.push({ text: item.text ?? '' }),
    });
    const invocation = createMockCommandContext({
      services: {
        config: { getTargetDir: () => '/workspace/invocation' },
        agent: {
          sessionClient: {
            runImageOperation: async () => ({
              absoluteOutputPath: '/workspace/invocation/out.png',
            }),
          },
        },
      },
    });

    await command.action?.(invocation, 'out.png "draw a cat"');

    expect(history).toStrictEqual([
      { text: 'Generated image.\nSaved to: /workspace/registered/out.png' },
    ]);
  });
});

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import React, { useEffect } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { ShellState, SessionIdentity } from '../cliUiRuntime.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import type { HistoryItemWithoutId } from '../types.js';
import { render } from '../../__tests__/render.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';

/**
 * ~202 KB of deterministic output: 2000 lines of "shellNNNN " + 90 x's.
 * Real shell execution through the real service, so the test observes the
 * actual commit boundary rather than a rehearsal of it.
 */
const LARGE_OUTPUT_COMMAND =
  'awk \'BEGIN{for(i=0;i<2000;i++)printf "shell%04d %s\\n",i,"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}\'';

interface ShellHarnessProps {
  config: ShellState & SessionIdentity;
  agent: Agent;
  addItemToHistory: UseHistoryManagerReturn['addItem'];
  onReady: (handler: (query: string, signal: AbortSignal) => boolean) => void;
  onExecPromise: (promise: Promise<void>) => void;
}

function ShellHarness({
  config,
  agent,
  addItemToHistory,
  onReady,
  onExecPromise,
}: ShellHarnessProps): React.ReactElement | null {
  const { handleShellCommand } = useShellCommandProcessor(
    addItemToHistory,
    vi.fn() as unknown as React.Dispatch<
      React.SetStateAction<HistoryItemWithoutId | null>
    >,
    (command) => {
      onExecPromise(command);
    },
    () => {},
    config,
    agent,
    () => {},
    120,
    40,
  );
  useEffect(() => {
    onReady(handleShellCommand);
  }, [handleShellCommand, onReady]);
  return null;
}

describe('useShellCommandProcessor — retention cap at shell commit (issue #3428)', () => {
  let targetDir: string;

  beforeEach(() => {
    targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-retention-'));
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
  });

  function buildConfig(): ShellState & SessionIdentity {
    return {
      getTargetDir: () => targetDir,
      getShouldUseNodePtyShell: () => false,
      getEnableInteractiveShell: () => false,
      getPtyTerminalWidth: () => undefined,
      getPtyTerminalHeight: () => undefined,
      setPtyTerminalSize: () => {},
      getTerminalBackground: () => undefined,
      getShellReplacement: () => 'off',
      getShellExecutionConfig: () => ({
        outputRetentionMaxBytes: 8 * 1024 * 1024,
      }),
    } as unknown as ShellState & SessionIdentity;
  }

  it('caps the committed shell display while the model copy keeps the full body', async () => {
    const committed: HistoryItemWithoutId[] = [];
    const agentHistory: Array<{ speaker: string; blocks: unknown[] }> = [];
    const agent = {
      addHistory: async (entry: { speaker: string; blocks: unknown[] }) => {
        agentHistory.push(entry);
      },
    } as unknown as Agent;
    let handler: ((query: string, signal: AbortSignal) => boolean) | undefined;
    let execPromise: Promise<void> | undefined;

    render(
      <ShellHarness
        config={buildConfig()}
        agent={agent}
        addItemToHistory={(item) => {
          // The store command carries the Omit<HistoryItem,'id'> family; the
          // assertions use the union form, which narrows through .find().
          committed.push(item as HistoryItemWithoutId);
          return committed.length;
        }}
        onReady={(h) => {
          handler = h;
        }}
        onExecPromise={(p) => {
          execPromise = p;
        }}
      />,
    );

    expect(handler).toBeDefined();
    const accepted = handler!(
      LARGE_OUTPUT_COMMAND,
      new AbortController().signal,
    );
    expect(accepted).toBe(true);

    await execPromise;
    await Promise.resolve();

    const toolGroup = committed.find((item) => item.type === 'tool_group');
    expect(toolGroup).toBeDefined();
    if (toolGroup?.type !== 'tool_group') return;
    const tool = toolGroup.tools[0];
    const display = tool.resultDisplay;

    expect(typeof display).toBe('string');
    expect(Buffer.byteLength(display as string, 'utf8')).toBeLessThanOrEqual(
      64 * 1024,
    );
    // The tail is what the capped display keeps.
    expect(display).toContain('shell1999');
    expect(display).toContain('session transcript');
    expect(tool.retention?.capped).toBe(true);
    expect(tool.retention?.originalLength).toBeGreaterThan(64 * 1024);

    // The model-facing agent history is written from the UNCAPPED output:
    // it carries the command output itself and no display marker.
    expect(agentHistory).toHaveLength(1);
    const text: string =
      (agentHistory[0]?.blocks[0] as { text?: string } | undefined)?.text ?? '';
    expect(text).toContain('```sh');
    expect(text).toContain('shell0000');
    expect(text).not.toContain('session transcript');
    expect(text.length).toBeGreaterThan(10_000);
  }, 30_000);
});

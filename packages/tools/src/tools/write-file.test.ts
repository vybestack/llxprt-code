/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WriteFileTool } from './write-file.js';
import { createDefaultToolHost } from './edit-utils.js';
import type {
  IToolHost,
  IIdeService,
  DiffParams,
  DiffUpdateResult,
  IDEConnectionStatus,
} from '../interfaces/index.js';
import type { ToolEditConfirmationDetails } from './tools.js';
import { ToolConfirmationOutcome } from './tools.js';

/**
 * A recording fake IIdeService. Behavioral: applyDiff resolves with the
 * configured outcome and records the params it was called with.
 */
function fakeIdeService(
  status: IDEConnectionStatus,
  outcome: DiffUpdateResult = { status: 'accepted', content: undefined },
): IIdeService & { applyDiffCalls: DiffParams[] } {
  const applyDiffCalls: DiffParams[] = [];
  return {
    applyDiffCalls,
    getConnectionStatus: () => status,
    applyDiff: async (params: DiffParams) => {
      applyDiffCalls.push(params);
      return outcome;
    },
    openDiff: async () => {},
  };
}

describe('WriteFileTool IDE diff integration', () => {
  let tmpDir: string;
  let host: IToolHost;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-file-ide-'));
    host = {
      ...createDefaultToolHost(),
      getTargetDir: () => tmpDir,
      getWorkspaceRoots: () => [tmpDir],
      // Manual approval so shouldConfirmExecute produces confirmation details.
      getApprovalMode: () => 'default',
    };
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getConfirmation(
    tool: WriteFileTool,
    filePath: string,
    content: string,
  ): Promise<ToolEditConfirmationDetails | false> {
    const invocation = tool.build({ absolute_path: filePath, content });
    return (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails | false;
  }

  it('opens an IDE diff (applyDiff) when the IDE service is connected', async () => {
    const ide = fakeIdeService('connected');
    const tool = new WriteFileTool(host, ide);
    const filePath = path.join(tmpDir, 'greeting.txt');

    const confirmation = await getConfirmation(tool, filePath, 'hello ide\n');

    expect(confirmation).not.toBe(false);
    const details = confirmation as ToolEditConfirmationDetails;
    expect(details.ideConfirmation).toBeDefined();
    expect(ide.applyDiffCalls).toHaveLength(1);
    expect(ide.applyDiffCalls[0].filePath).toBe(filePath);
    expect(ide.applyDiffCalls[0].diff).toBe('hello ide\n');
  });

  it('does NOT open an IDE diff when the IDE service is disconnected', async () => {
    const ide = fakeIdeService('disconnected');
    const tool = new WriteFileTool(host, ide);
    const filePath = path.join(tmpDir, 'greeting.txt');

    const confirmation = await getConfirmation(tool, filePath, 'hello\n');

    expect(confirmation).not.toBe(false);
    const details = confirmation as ToolEditConfirmationDetails;
    expect(details.ideConfirmation).toBeUndefined();
    expect(ide.applyDiffCalls).toHaveLength(0);
  });

  it('does NOT open an IDE diff when no IDE service is provided', async () => {
    const tool = new WriteFileTool(host);
    const filePath = path.join(tmpDir, 'greeting.txt');

    const confirmation = await getConfirmation(tool, filePath, 'hello\n');

    expect(confirmation).not.toBe(false);
    const details = confirmation as ToolEditConfirmationDetails;
    expect(details.ideConfirmation).toBeUndefined();
  });

  it('writes the IDE-modified content when the user edits in the diff view', async () => {
    const ide = fakeIdeService('connected', {
      status: 'accepted',
      content: 'user-edited content\n',
    });
    const tool = new WriteFileTool(host, ide);
    const filePath = path.join(tmpDir, 'edited.txt');

    const invocation = tool.build({
      absolute_path: filePath,
      content: 'model content\n',
    });
    const confirmation = (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails;
    expect(confirmation.ideConfirmation).toBeDefined();

    await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('user-edited content\n');
  });

  it('writes the original content when the IDE accepts without modification', async () => {
    const ide = fakeIdeService('connected', {
      status: 'accepted',
      content: undefined,
    });
    const tool = new WriteFileTool(host, ide);
    const filePath = path.join(tmpDir, 'unmodified.txt');

    const invocation = tool.build({
      absolute_path: filePath,
      content: 'model content\n',
    });
    const confirmation = (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails;

    await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('model content\n');
  });
});

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ASTEditTool } from './ast-edit.js';
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

describe('ASTEditTool IDE diff integration', () => {
  let tmpDir: string;
  let host: IToolHost;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-edit-ide-'));
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

  /**
   * Builds an ast_edit invocation in execution mode (force: true) and returns
   * its confirmation details (or false).
   */
  async function getConfirmation(
    tool: ASTEditTool,
    filePath: string,
    oldString: string,
    newString: string,
  ): Promise<ToolEditConfirmationDetails | false> {
    const invocation = tool.build({
      file_path: filePath,
      old_string: oldString,
      new_string: newString,
      force: true,
    });
    return (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails | false;
  }

  it('opens an IDE diff (applyDiff) when the IDE service is connected', async () => {
    const ide = fakeIdeService('connected');
    // ASTEditTool signature: (host, ideService, lspService)
    const tool = new ASTEditTool(host, ide);
    const filePath = path.join(tmpDir, 'greeting.ts');
    fs.writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const confirmation = await getConfirmation(
      tool,
      filePath,
      'const greeting = "hello";',
      'const greeting = "world";',
    );

    expect(confirmation).not.toBe(false);
    const details = confirmation as ToolEditConfirmationDetails;
    expect(details.ideConfirmation).toBeDefined();
    expect(ide.applyDiffCalls).toHaveLength(1);
    expect(ide.applyDiffCalls[0].filePath).toBe(filePath);
    expect(ide.applyDiffCalls[0].diff).toBe('const greeting = "world";\n');
  });

  it('does NOT open an IDE diff when the IDE service is disconnected', async () => {
    const ide = fakeIdeService('disconnected');
    const tool = new ASTEditTool(host, ide);
    const filePath = path.join(tmpDir, 'greeting.ts');
    fs.writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const confirmation = await getConfirmation(
      tool,
      filePath,
      'const greeting = "hello";',
      'const greeting = "world";',
    );

    expect(confirmation).not.toBe(false);
    const details = confirmation as ToolEditConfirmationDetails;
    expect(details.ideConfirmation).toBeUndefined();
    expect(ide.applyDiffCalls).toHaveLength(0);
  });

  it('does NOT open an IDE diff when no IDE service is provided', async () => {
    const tool = new ASTEditTool(host);
    const filePath = path.join(tmpDir, 'greeting.ts');
    fs.writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const confirmation = await getConfirmation(
      tool,
      filePath,
      'const greeting = "hello";',
      'const greeting = "world";',
    );

    expect(confirmation).not.toBe(false);
    const details = confirmation as ToolEditConfirmationDetails;
    expect(details.ideConfirmation).toBeUndefined();
  });

  it('writes the IDE-modified content when the user edits in the diff view', async () => {
    const ide = fakeIdeService('connected', {
      status: 'accepted',
      content: 'const greeting = "user-edited";\n',
    });
    const tool = new ASTEditTool(host, ide);
    const filePath = path.join(tmpDir, 'edited.ts');
    fs.writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const invocation = tool.build({
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
      force: true,
    });
    const confirmation = (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails;
    expect(confirmation.ideConfirmation).toBeDefined();

    await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      'const greeting = "user-edited";\n',
    );
  });

  it('writes the model content when the IDE accepts without modification', async () => {
    const ide = fakeIdeService('connected', {
      status: 'accepted',
      content: undefined,
    });
    const tool = new ASTEditTool(host, ide);
    const filePath = path.join(tmpDir, 'unmodified.ts');
    fs.writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const invocation = tool.build({
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
      force: true,
    });
    const confirmation = (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails;

    await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      'const greeting = "world";\n',
    );
  });

  it('writes the model content when the IDE rejects the diff', async () => {
    const ide = fakeIdeService('connected', {
      status: 'rejected',
      content: undefined,
    });
    const tool = new ASTEditTool(host, ide);
    const filePath = path.join(tmpDir, 'rejected.ts');
    fs.writeFileSync(filePath, 'const greeting = "hello";\n', 'utf-8');

    const invocation = tool.build({
      file_path: filePath,
      old_string: 'const greeting = "hello";',
      new_string: 'const greeting = "world";',
      force: true,
    });
    const confirmation = (await invocation.shouldConfirmExecute(
      new AbortController().signal,
    )) as ToolEditConfirmationDetails;
    expect(confirmation.ideConfirmation).toBeDefined();

    await confirmation.onConfirm(ToolConfirmationOutcome.ProceedOnce);
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error).toBeUndefined();
    // Rejected diff must not override the model-computed content.
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      'const greeting = "world";\n',
    );
  });
});

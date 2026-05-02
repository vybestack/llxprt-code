/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditTool } from './edit.js';
import { WriteFileTool } from './write-file.js';
import { GoogleWebFetchTool } from './google-web-fetch.js';
import { ToolConfirmationOutcome } from './tools.js';
import { ApprovalMode } from '../policy/types.js';
import { MessageBusType } from '../confirmation-bus/types.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { Config } from '../config/config.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Mock telemetry loggers to avoid failures
vi.mock('../telemetry/loggers.js', () => ({
  logFileOperation: vi.fn(),
}));

describe('Tool Confirmation Policy Updates', () => {
  let mockConfig: any;
  let mockMessageBus: MessageBus;
  const rootDir = path.join(
    os.tmpdir(),
    `gemini-cli-policy-test-${Date.now()}`,
  );

  beforeEach(() => {
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true });
    }

    mockMessageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as unknown as MessageBus;

    mockConfig = {
      getTargetDir: () => rootDir,
      getApprovalMode: vi.fn().mockReturnValue(ApprovalMode.DEFAULT),
      setApprovalMode: vi.fn(),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      getFileSystemService: () => ({
        readTextFile: vi.fn().mockImplementation((p) => {
          if (fs.existsSync(p)) {
            return fs.readFileSync(p, 'utf8');
          }
          return 'existing content';
        }),
        writeTextFile: vi.fn().mockImplementation((p, c) => {
          fs.writeFileSync(p, c);
        }),
      }),
      getFileService: () => ({}),
      getFileFilteringOptions: () => ({}),
      getGeminiClient: () => ({}),
      getBaseLlmClient: () => ({}),
      getIdeMode: () => false,
      getIdeClient: () => undefined,
      getWorkspaceContext: () => ({
        isPathWithinWorkspace: () => true,
        getDirectories: () => [rootDir],
      }),
    };
  });

  afterEach(() => {
    if (fs.existsSync(rootDir)) {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  const tools = [
    {
      name: 'EditTool',
      create: (config: Config, bus: MessageBus) => new EditTool(config, bus),
      getParams: () => ({
        file_path: path.join(rootDir, 'test.txt'),
        old_string: 'existing',
        new_string: 'new',
      }),
    },
    {
      name: 'WriteFileTool',
      create: (config: Config, bus: MessageBus) =>
        new WriteFileTool(config, bus),
      getParams: () => ({
        file_path: path.join(rootDir, 'test.txt'),
        content: 'new content',
      }),
    },
    {
      name: 'GoogleWebFetchTool',
      create: (config: Config, bus: MessageBus) =>
        new GoogleWebFetchTool(config, bus),
      getParams: () => ({
        prompt: 'fetch https://example.com',
      }),
    },
  ];

  describe.each(tools)('$name policy updates', ({ create, getParams }) => {
    it.each([
      {
        outcome: ToolConfirmationOutcome.ProceedAlways,
        shouldPublish: false,
        expectedApprovalMode: ApprovalMode.AUTO_EDIT,
      },
      {
        outcome: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        shouldPublish: true,
        persist: true,
      },
    ])(
      'should handle $outcome correctly',
      async ({ outcome, shouldPublish, persist, expectedApprovalMode }) => {
        const tool = create(mockConfig, mockMessageBus);
        const params = getParams();

        // For file-based tools, ensure the file exists if needed
        // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
        if (params.file_path != null && params.file_path !== '') {
          const fullPath = path.isAbsolute(params.file_path)
            ? params.file_path
            : path.join(rootDir, params.file_path);
          fs.writeFileSync(fullPath, 'existing content');
        }

        const invocation = tool.build(params as any);

        // Mock getMessageBusDecision to trigger ASK_USER flow
        vi.spyOn(invocation as any, 'getMessageBusDecision').mockResolvedValue(
          'ASK_USER',
        );

        const confirmation = await invocation.shouldConfirmExecute(
          new AbortController().signal,
        );
        expect(confirmation).not.toBe(false);

        const runtimeConfirmation = confirmation as unknown;
        const confirmationIsMissingOrFalse =
          runtimeConfirmation == null || runtimeConfirmation === false;
        expect(confirmationIsMissingOrFalse).toBe(false);
        await confirmation.onConfirm(outcome);

        // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
        if (shouldPublish === true) {
          // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
          expect(mockMessageBus.publish).toHaveBeenCalledWith(
            // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
            expect.objectContaining({
              type: MessageBusType.UPDATE_POLICY,
              persist,
            }),
          );
        } else {
          // Should not publish UPDATE_POLICY message for ProceedAlways
          const publishCalls = (mockMessageBus.publish as any).mock.calls;
          const hasUpdatePolicy = publishCalls.some(
            (call: any[]) => call[0]?.type === MessageBusType.UPDATE_POLICY,
          );
          // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
          expect(hasUpdatePolicy).toBe(false);
        }

        // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
        if (expectedApprovalMode !== undefined) {
          // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
          expect(mockConfig.setApprovalMode).toHaveBeenCalledWith(
            expectedApprovalMode,
          );
        }
      },
    );
  });
});

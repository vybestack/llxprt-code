/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreToolScheduler } from './coreToolScheduler.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import {
  createMockMessageBus,
  createMockPolicyEngine,
} from './coreToolScheduler-test-helpers.js';

describe('CoreToolScheduler getToolSuggestion', () => {
  it('should suggest the top N closest tool names for a typo', () => {
    // Create mocked tool registry
    const mockToolRegistry = {
      getAllToolNames: () => ['list_files', 'read_file', 'write_file'],
    } as unknown as ToolRegistry;
    const mockConfig = {
      getToolRegistry: () => mockToolRegistry,
      getMessageBus: vi.fn().mockReturnValue(createMockMessageBus()),
      getEnableHooks: () => false,
      getPolicyEngine: vi.fn().mockReturnValue(createMockPolicyEngine()),
      getModel: () => DEFAULT_GEMINI_MODEL,
    } as unknown as Config;

    // Create scheduler
    const scheduler = new CoreToolScheduler({
      config: mockConfig,
      messageBus: mockConfig.getMessageBus(),
      toolRegistry: mockConfig.getToolRegistry(),
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    // Test that the right tool is selected, with only 1 result, for typos
    // @ts-expect-error accessing private method
    const misspelledTool = scheduler.getToolSuggestion('list_fils', 1);
    expect(misspelledTool).toBe(' Did you mean "list_files"?');

    // Test that the right tool is selected, with only 1 result, for prefixes
    // @ts-expect-error accessing private method
    const prefixedTool = scheduler.getToolSuggestion('github.list_files', 1);
    expect(prefixedTool).toBe(' Did you mean "list_files"?');

    // Test that the right tool is first
    // @ts-expect-error accessing private method
    const suggestionMultiple = scheduler.getToolSuggestion('list_fils');
    expect(suggestionMultiple).toBe(
      ' Did you mean one of: "list_files", "read_file", "write_file"?',
    );
  });
});

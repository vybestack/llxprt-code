/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { installSchedulerToolFixture } from './__tests__/scheduler-tool-owner-fixture.js';
import { MockTool } from '@vybestack/llxprt-code-test-utils/core/mock-tool.js';

import { describe, it, expect, vi } from 'bun:test';
import { CoreToolScheduler } from './coreToolScheduler.js';

describe('CoreToolScheduler getToolSuggestion', () => {
  const fixtureRoot = installSchedulerToolFixture();
  it('should suggest the top N closest tool names for a typo', () => {
    // Create mocked tool registry

    const fixture = fixtureRoot(
      ['list_files', 'read_file', 'write_file'].map(
        (name) => new MockTool({ name }),
      ),
      { sessionId: 'test-session-id', interactive: false },
    );

    // Create scheduler
    const scheduler = new CoreToolScheduler({
      config: fixture.config,
      telemetry: fixture.settingsOwner.telemetry,
      readExecutionPolicy: () =>
        fixture.settingsOwner.readToolExecutionPolicy(),
      getToolGovernance: () =>
        fixture.settingsOwner.readToolGovernance(
          fixture.config.getExcludeTools() ?? [],
        ),
      messageBus: fixture.messageBus,
      toolRegistry: fixture.selection,
      getPreferredEditor: () => 'vscode',
      onEditorClose: vi.fn(),
    });

    // Test that the right tool is selected, with only 1 result, for typos
    const misspelledTool = scheduler.getToolSuggestion('list_fils', 1);
    expect(misspelledTool).toBe(' Did you mean "list_files"?');

    // Test that the right tool is selected, with only 1 result, for prefixes
    const prefixedTool = scheduler.getToolSuggestion('github.list_files', 1);
    expect(prefixedTool).toBe(' Did you mean "list_files"?');

    // Test that the right tool is first
    const suggestionMultiple = scheduler.getToolSuggestion('list_fils');
    expect(suggestionMultiple).toBe(
      ' Did you mean one of: "list_files", "read_file", "write_file"?',
    );
  });
});

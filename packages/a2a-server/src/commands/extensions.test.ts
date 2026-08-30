/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { ExtensionsCommand, ListExtensionsCommand } from './extensions.js';
import type { CommandContext } from './types.js';
import type { LlxprtExtension } from '@vybestack/llxprt-code-core';

function contextWithExtensions(
  extensions: readonly LlxprtExtension[],
): CommandContext {
  return {
    extensions,
    model: 'test-model',
    checkpointing: {
      enabled: true,
      getProjectTempCheckpointsDir: () => '/tmp/test-checkpoints',
    },
  };
}

describe('ExtensionsCommand', () => {
  it('should have the correct name', () => {
    const command = new ExtensionsCommand();
    expect(command.name).toStrictEqual('extensions');
  });

  it('should have the correct description', () => {
    const command = new ExtensionsCommand();
    expect(command.description).toStrictEqual('Manage extensions.');
  });

  it('should have "extensions list" as a subcommand', () => {
    const command = new ExtensionsCommand();
    expect(command.subCommands.map((c) => c.name)).toContain('extensions list');
  });

  it('should be a top-level command', () => {
    const command = new ExtensionsCommand();
    expect(command.topLevel).toBe(true);
  });

  it('should default to listing extensions', async () => {
    const command = new ExtensionsCommand();
    const mockExtensions = [{ name: 'ext1' }] as LlxprtExtension[];
    const result = await command.execute(
      contextWithExtensions(mockExtensions),
      [],
    );
    expect(result).toStrictEqual({
      name: 'extensions list',
      data: mockExtensions,
    });
  });
});

describe('ListExtensionsCommand', () => {
  it('should have the correct name', () => {
    const command = new ListExtensionsCommand();
    expect(command.name).toStrictEqual('extensions list');
  });

  it('should return installed extensions from the host context', async () => {
    const command = new ListExtensionsCommand();
    const mockExtensions = [{ name: 'ext1' }] as LlxprtExtension[];
    const result = await command.execute(
      contextWithExtensions(mockExtensions),
      [],
    );
    expect(result).toStrictEqual({
      name: 'extensions list',
      data: mockExtensions,
    });
  });

  it('should return a message when no extensions are installed', async () => {
    const command = new ListExtensionsCommand();
    const result = await command.execute(contextWithExtensions([]), []);
    expect(result).toStrictEqual({
      name: 'extensions list',
      data: 'No extensions installed.',
    });
  });
});

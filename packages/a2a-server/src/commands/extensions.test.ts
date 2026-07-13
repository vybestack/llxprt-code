/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { ExtensionsCommand, ListExtensionsCommand } from './extensions.js';
import type { Config } from '@vybestack/llxprt-code-core';

const mockListExtensions = vi.fn();

describe('ExtensionsCommand', () => {
  beforeEach(() => {
    mockListExtensions.mockReset();
  });

  it('should have the correct name', () => {
    const command = new ExtensionsCommand(mockListExtensions);
    expect(command.name).toStrictEqual('extensions');
  });

  it('should have the correct description', () => {
    const command = new ExtensionsCommand(mockListExtensions);
    expect(command.description).toStrictEqual('Manage extensions.');
  });

  it('should have "extensions list" as a subcommand', () => {
    const command = new ExtensionsCommand(mockListExtensions);
    expect(command.subCommands.map((c) => c.name)).toContain('extensions list');
  });

  it('should be a top-level command', () => {
    const command = new ExtensionsCommand(mockListExtensions);
    expect(command.topLevel).toBe(true);
  });

  it('should default to listing extensions', async () => {
    const command = new ExtensionsCommand(mockListExtensions);
    const mockConfig = {} as Config;
    const mockExtensions = [{ name: 'ext1' }];
    mockListExtensions.mockReturnValue(mockExtensions);

    const result = await command.execute({ config: mockConfig }, []);

    expect(result).toStrictEqual({
      name: 'extensions list',
      data: mockExtensions,
    });
    expect(mockListExtensions).toHaveBeenCalledWith(mockConfig);
  });
});

describe('ListExtensionsCommand', () => {
  beforeEach(() => {
    mockListExtensions.mockReset();
  });

  it('should have the correct name', () => {
    const command = new ListExtensionsCommand(mockListExtensions);
    expect(command.name).toStrictEqual('extensions list');
  });

  it('should call listExtensions with the provided config', async () => {
    const command = new ListExtensionsCommand(mockListExtensions);
    const mockConfig = {} as Config;
    const mockExtensions = [{ name: 'ext1' }];
    mockListExtensions.mockReturnValue(mockExtensions);

    const result = await command.execute({ config: mockConfig }, []);

    expect(result).toStrictEqual({
      name: 'extensions list',
      data: mockExtensions,
    });
    expect(mockListExtensions).toHaveBeenCalledWith(mockConfig);
  });

  it('should return a message when no extensions are installed', async () => {
    const command = new ListExtensionsCommand(mockListExtensions);
    const mockConfig = {} as Config;
    mockListExtensions.mockReturnValue([]);

    const result = await command.execute({ config: mockConfig }, []);

    expect(result).toStrictEqual({
      name: 'extensions list',
      data: 'No extensions installed.',
    });
    expect(mockListExtensions).toHaveBeenCalledWith(mockConfig);
  });
});

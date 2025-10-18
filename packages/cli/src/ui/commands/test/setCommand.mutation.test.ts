/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setCommand } from '../setCommand.js';
import { createMockCommandContext } from '../../../test-utils/mockCommandContext.js';
import type { CommandContext } from '../types.js';
vi.mock('../../../runtime/runtimeSettings.js', () => ({
  getActiveModelParams: vi.fn(() => ({})),
  getEphemeralSettings: vi.fn(() => ({})),
  setEphemeralSetting: vi.fn(),
  setActiveModelParam: vi.fn(),
  clearActiveModelParam: vi.fn(),
}));
import { setEphemeralSetting } from '../../../runtime/runtimeSettings.js';

describe('setCommand action mutation coverage', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
  });

  it('stores numeric context-limit values', async () => {
    const result = await setCommand.action!(context, 'context-limit 32000');

    expect(setEphemeralSetting).toHaveBeenCalledWith('context-limit', 32000);
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'context-limit' set to 32000 (session only, use /profile save to persist)",
    });
  });

  it('rejects invalid numeric input', async () => {
    const result = await setCommand.action!(
      context,
      'context-limit not-a-number',
    );

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'context-limit must be a positive integer (e.g., 100000)',
    });
  });

  it('normalizes boolean settings', async () => {
    const result = await setCommand.action!(context, 'socket-keepalive true');

    expect(setEphemeralSetting).toHaveBeenCalledWith('socket-keepalive', true);
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'socket-keepalive' set to true (session only, use /profile save to persist)",
    });
  });

  it('validates streaming enums', async () => {
    const success = await setCommand.action!(context, 'streaming enabled');
    expect(success).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    expect(setEphemeralSetting).toHaveBeenCalledWith('streaming', 'enabled');

    const failure = await setCommand.action!(context, 'streaming maybe');
    expect(failure).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        "Invalid streaming mode 'maybe'. Valid modes are: enabled, disabled",
    });
  });

  it('validates compression-threshold bounds', async () => {
    const success = await setCommand.action!(
      context,
      'compression-threshold 0.75',
    );
    expect(success).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    expect(setEphemeralSetting).toHaveBeenCalledWith(
      'compression-threshold',
      0.75,
    );

    const failure = await setCommand.action!(
      context,
      'compression-threshold 1.4',
    );
    expect(failure).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)',
    });
  });

  it('accepts special maxTurnsPerPrompt values', async () => {
    const success = await setCommand.action!(context, 'maxTurnsPerPrompt -1');
    expect(success).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    expect(setEphemeralSetting).toHaveBeenCalledWith('maxTurnsPerPrompt', -1);
  });

  it('guards positive integer validations', async () => {
    const success = await setCommand.action!(
      context,
      'tool-output-max-items 25',
    );
    expect(success).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    expect(setEphemeralSetting).toHaveBeenCalledWith(
      'tool-output-max-items',
      25,
    );

    const failure = await setCommand.action!(
      context,
      'tool-output-max-items 0',
    );
    expect(failure).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'tool-output-max-items must be a positive integer',
    });
  });

  it('lowercases emojifilter values', async () => {
    await setCommand.action!(context, 'emojifilter AUTO');

    expect(setEphemeralSetting).toHaveBeenCalledWith('emojifilter', 'auto');
  });

  it('accepts truncate mode enumerations', async () => {
    const result = await setCommand.action!(
      context,
      'tool-output-truncate-mode sample',
    );

    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
    expect(setEphemeralSetting).toHaveBeenCalledWith(
      'tool-output-truncate-mode',
      'sample',
    );
  });

  it('normalizes socket flags independently', async () => {
    await setCommand.action!(context, 'socket-nodelay false');

    expect(setEphemeralSetting).toHaveBeenCalledWith('socket-nodelay', false);
  });

  it('parses JSON payloads for custom headers', async () => {
    await setCommand.action!(
      context,
      'custom-headers {"Authorization":"Bearer token"}',
    );

    expect(setEphemeralSetting).toHaveBeenCalledWith('custom-headers', {
      Authorization: 'Bearer token',
    });
  });

  it('stores malformed JSON payloads as literal strings', async () => {
    const result = await setCommand.action!(
      context,
      'custom-headers {"Authorization":"Bearer token"',
    );

    expect(setEphemeralSetting).toHaveBeenCalledWith(
      'custom-headers',
      '{"Authorization":"Bearer token"',
    );
    expect(result).toMatchObject({
      type: 'message',
      messageType: 'info',
    });
  });
});

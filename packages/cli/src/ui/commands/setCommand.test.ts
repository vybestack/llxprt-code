/*
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';
import { setCommand } from './setCommand.js';

const mockRuntime = {
  getActiveModelParams: vi.fn(() => ({})),
  getEphemeralSettings: vi.fn(() => ({})),
  setEphemeralSetting: vi.fn(),
  setActiveModelParam: vi.fn(),
  clearActiveModelParam: vi.fn(),
};

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));

describe('setCommand runtime integration', () => {
  let context: CommandContext;

  beforeEach(() => {
    context = createMockCommandContext();
    vi.clearAllMocks();
  });

  it('requires arguments and shows usage when missing', async () => {
    const result = await setCommand.action!(context, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set <ephemeral-key> <value>\nExample: /set context-limit 100000\n\nFor model parameters use: /set modelparam <key> <value>',
    });
  });

  it('stores numeric ephemeral settings via runtime helper', async () => {
    const result = await setCommand.action!(context, 'context-limit 32000');

    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'context-limit',
      32000,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'context-limit' set to 32000 (session only, use /profile save to persist)",
    });
  });

  it('parses JSON payloads for custom headers', async () => {
    const payload =
      'custom-headers {"Authorization":"Bearer token","X-Test":"value"}';
    const result = await setCommand.action!(context, payload);

    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'custom-headers',
      expect.objectContaining({
        Authorization: 'Bearer token',
        'X-Test': 'value',
      }),
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content:
        'Ephemeral setting \'custom-headers\' set to {"Authorization":"Bearer token","X-Test":"value"} (session only, use /profile save to persist)',
    });
  });

  it('sets streaming with boolean true value', async () => {
    // Issue #884: /set streaming true should work without error
    const result = await setCommand.action!(context, 'streaming true');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting 'streaming' set to "enabled" (session only, use /profile save to persist)`,
    });
    // setEphemeralSetting is called via the runtime helper, not directly on config
    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'streaming',
      'enabled',
    );
  });

  it('sets streaming with boolean false value', async () => {
    // Issue #884: /set streaming false should work without error
    const result = await setCommand.action!(context, 'streaming false');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `Ephemeral setting 'streaming' set to "disabled" (session only, use /profile save to persist)`,
    });
    // setEphemeralSetting is called via the runtime helper, not directly on config
    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'streaming',
      'disabled',
    );
  });

  it('rejects invalid ephemeral keys', async () => {
    const result = await setCommand.action!(context, 'invalid-key value');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Invalid setting key: invalid-key. Valid keys are: context-limit, compression-threshold, base-url, tool-format, api-version, custom-headers, user-agent, stream-options, streaming, shell-replacement, socket-timeout, socket-keepalive, socket-nodelay, tool-output-max-items, tool-output-max-tokens, tool-output-truncate-mode, tool-output-item-size-limit, max-prompt-tokens, emojifilter, retries, retrywait, maxTurnsPerPrompt, authOnly, dumponerror, dumpcontext, prompt-caching, include-folder-structure, rate-limit-throttle, rate-limit-throttle-threshold, rate-limit-max-wait, reasoning.enabled, reasoning.includeInContext, reasoning.includeInResponse, reasoning.format, reasoning.stripFromContext, reasoning.effort, reasoning.maxTokens, enable-tool-prompts, tpm_threshold, timeout_ms, circuit_breaker_enabled, circuit_breaker_failure_threshold, circuit_breaker_failure_window_ms, circuit_breaker_recovery_timeout_ms',
    });
  });

  it('validates compression threshold range', async () => {
    const result = await setCommand.action!(
      context,
      'compression-threshold 1.5',
    );

    expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'compression-threshold must be a decimal between 0 and 1 (e.g., 0.7 for 70%)',
    });
  });

  it('sets model parameters through runtime helper', async () => {
    const result = await setCommand.action!(
      context,
      'modelparam temperature 0.7',
    );

    expect(mockRuntime.setActiveModelParam).toHaveBeenCalledWith(
      'temperature',
      0.7,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Model parameter 'temperature' set to 0.7",
    });
  });

  it('requires both key and value for modelparam', async () => {
    const result = await setCommand.action!(context, 'modelparam temperature');

    expect(mockRuntime.setActiveModelParam).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set modelparam <key> <value>\nExample: /set modelparam temperature 0.7',
    });
  });

  it('surfaces runtime errors from model parameter helper', async () => {
    mockRuntime.setActiveModelParam.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    const result = await setCommand.action!(context, 'modelparam foo 1');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: 'Failed to set model parameter: boom',
    });
  });

  it('clears ephemeral settings via unset', async () => {
    const result = await setCommand.action!(context, 'unset base-url');

    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'base-url',
      undefined,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Ephemeral setting 'base-url' cleared",
    });
  });

  it('clears model parameters via unset modelparam', async () => {
    const result = await setCommand.action!(context, 'unset modelparam foo');

    expect(mockRuntime.clearActiveModelParam).toHaveBeenCalledWith('foo');
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Model parameter 'foo' cleared",
    });
  });

  it('requires model parameter name when clearing modelparam', async () => {
    const result = await setCommand.action!(context, 'unset modelparam');

    expect(mockRuntime.clearActiveModelParam).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content:
        'Usage: /set unset modelparam <key>\nExample: /set unset modelparam temperature',
    });
  });

  it('handles nested custom header removal when header exists', async () => {
    mockRuntime.getEphemeralSettings.mockReturnValueOnce({
      'custom-headers': { 'X-Test': 'value' },
    });

    const result = await setCommand.action!(
      context,
      'unset custom-headers X-Test',
    );

    expect(mockRuntime.setEphemeralSetting).toHaveBeenCalledWith(
      'custom-headers',
      undefined,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "Custom header 'X-Test' cleared",
    });
  });

  it('returns informational message when nested custom header missing', async () => {
    mockRuntime.getEphemeralSettings.mockReturnValueOnce({
      'custom-headers': { 'X-Other': 'value' },
    });

    const result = await setCommand.action!(
      context,
      'unset custom-headers X-Test',
    );

    expect(mockRuntime.setEphemeralSetting).not.toHaveBeenCalled();
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: "No custom header named 'X-Test' found",
    });
  });
});

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keyCommand } from './keyCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';

const mockRuntime = vi.hoisted(() => ({
  updateActiveProviderApiKey: vi.fn(),
  getActiveProviderStatus: vi.fn(),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => mockRuntime,
}));

describe('keyCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
    mockRuntime.getActiveProviderStatus.mockReturnValue({
      providerName: 'test-provider',
      modelName: 'model-x',
      displayLabel: 'test-provider:model-x',
    });
    mockRuntime.updateActiveProviderApiKey.mockResolvedValue({
      changed: true,
      providerName: 'test-provider',
      message: 'API key updated for provider',
      isPaidMode: true,
    });
  });

  it('updates API key when value provided', async () => {
    const result = await keyCommand.action!(context, 'abc123');

    expect(mockRuntime.updateActiveProviderApiKey).toHaveBeenCalledWith(
      'abc123',
    );
    expect(result?.type).toBe('message');
  });

  it('removes API key when argument is none', async () => {
    mockRuntime.updateActiveProviderApiKey.mockResolvedValue({
      changed: true,
      providerName: 'test-provider',
      message: 'API key removed',
    });

    const result = await keyCommand.action!(context, 'none');

    expect(mockRuntime.updateActiveProviderApiKey).toHaveBeenCalledWith(null);
    expect(result?.type).toBe('message');
    expect(result).toBeDefined();
    expect((result as { content: string }).content).toContain(
      'API key removed',
    );
  });

  it('returns error when updateActiveProviderApiKey throws', async () => {
    mockRuntime.updateActiveProviderApiKey.mockRejectedValue(
      new Error('unsupported'),
    );

    const result = await keyCommand.action!(context, 'abc123');

    expect(result?.type).toBe('message');
    expect(result).toBeDefined();
    expect((result as { messageType: string }).messageType).toBe('error');
    expect((result as { content: string }).content).toContain('unsupported');
  });

  it('invokes payment mode callback asynchronously', async () => {
    vi.useFakeTimers();
    const checkPaymentModeChange = vi.fn();
    const extendedContext = {
      ...context,
      checkPaymentModeChange,
    } as CommandContext & { checkPaymentModeChange: () => void };

    await keyCommand.action!(extendedContext, 'abc123');

    expect(checkPaymentModeChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(checkPaymentModeChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

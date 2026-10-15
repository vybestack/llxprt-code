/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import { registerKeyCommand } from '../../__tests__/credential-command-test-owner.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';

const mockRuntime = {
  updateActiveProviderApiKey: vi.fn(),
  providerStatus: vi.fn(),
};

describe('keyCommand', () => {
  let context: CommandOwnerFixture;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext({ runtimeApi: mockRuntime });
    mockRuntime.providerStatus.mockReturnValue({
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
    const result = await registerKeyCommand(context).action!(context, 'abc123');

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

    const result = await registerKeyCommand(context).action!(context, 'none');

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

    const result = await registerKeyCommand(context).action!(context, 'abc123');

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
    } as CommandOwnerFixture & { checkPaymentModeChange: () => void };

    await registerKeyCommand(context, {
      schedulePaymentModeCheck: extendedContext.checkPaymentModeChange,
    }).action!(extendedContext, 'abc123');

    expect(checkPaymentModeChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(checkPaymentModeChange).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

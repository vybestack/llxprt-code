import { detectFromProviderConfig } from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from '../../__tests__/mockCommandContext.js';

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  setSystemTime,
} from 'bun:test';
import { registerStatsCommand } from '../../__tests__/stats-command-test-owner.js';

import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { MessageType } from '../types.js';

const getEphemeralSettingMock = vi.fn();
const getActiveProviderNameMock = vi.fn();
const providerManagerMock = vi.fn();

describe('statsCommand null sessionStartTime guard', () => {
  let mockContext: CommandOwnerFixture;

  beforeEach(() => {
    vi.useFakeTimers();
    setSystemTime(new Date('2025-07-14T10:00:30.000Z'));

    mockContext = createMockCommandContext({
      runtimeApi: {
        fetch: (
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => globalThis.fetch(input, init),
        getEphemeralSetting: getEphemeralSettingMock,
        getActiveProviderName: getActiveProviderNameMock,
        detectProviderQuota: (name: string) => {
          const provider = providerManagerMock()?.getProviderByName(name);
          return provider === undefined
            ? undefined
            : detectFromProviderConfig(provider);
        },
      },
    });
    getEphemeralSettingMock.mockReset();
    getActiveProviderNameMock.mockReset();
    providerManagerMock.mockReset();
    getEphemeralSettingMock.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show an error when sessionStartTime is null', async () => {
    mockContext.session.stats.sessionStartTime = null as unknown as Date;

    await registerStatsCommand(mockContext).action!(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Session start time is unavailable, cannot calculate stats.',
      },
      expect.any(Number),
    );
  });

  it('should show an error when sessionStartTime is undefined', async () => {
    mockContext.session.stats.sessionStartTime = undefined as unknown as Date;

    await registerStatsCommand(mockContext).action!(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Session start time is unavailable, cannot calculate stats.',
      },
      expect.any(Number),
    );
  });
});

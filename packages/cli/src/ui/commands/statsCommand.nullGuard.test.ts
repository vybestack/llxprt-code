import { detectFromProviderConfig } from '../../runtime/providerInspection.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  setSystemTime,
} from 'bun:test';
import { statsCommand } from './statsCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { MessageType } from '../types.js';

const getEphemeralSettingMock = vi.fn();
const getActiveProviderNameMock = vi.fn();
const providerManagerMock = vi.fn();

describe('statsCommand null sessionStartTime guard', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.useFakeTimers();
    setSystemTime(new Date('2025-07-14T10:00:30.000Z'));

    mockContext = createMockCommandContext({
      runtimeApi: {
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

    await statsCommand.action!(mockContext, '');

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

    await statsCommand.action!(mockContext, '');

    expect(mockContext.ui.addItem).toHaveBeenCalledWith(
      {
        type: MessageType.ERROR,
        text: 'Session start time is unavailable, cannot calculate stats.',
      },
      expect.any(Number),
    );
  });
});

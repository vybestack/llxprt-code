/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { statsCommand } from './statsCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { MessageType } from '../types.js';

const getCliOAuthManagerMock = vi.fn();
const getEphemeralSettingMock = vi.fn();
const getActiveProviderNameMock = vi.fn();
const getCliProviderManagerMock = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getCliOAuthManager: getCliOAuthManagerMock,
    getEphemeralSetting: getEphemeralSettingMock,
    getActiveProviderName: getActiveProviderNameMock,
    getCliProviderManager: getCliProviderManagerMock,
  }),
}));

describe('statsCommand null sessionStartTime guard', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-07-14T10:00:30.000Z'));

    mockContext = createMockCommandContext();
    getCliOAuthManagerMock.mockReset();
    getEphemeralSettingMock.mockReset();
    getActiveProviderNameMock.mockReset();
    getCliProviderManagerMock.mockReset();
    getEphemeralSettingMock.mockReturnValue(undefined);
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

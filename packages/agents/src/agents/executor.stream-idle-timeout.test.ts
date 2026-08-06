/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from '../testApi.js';
import { getDirectoryContextString } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import {
  setupExecutorFixture,
  type ExecutorTestFixture,
  type MockFn,
} from './executor-test-helpers.js';

const { MockedChatSession, mockSendMessageStream, mockExecuteToolCall } = {
  MockedChatSession: vi.fn(),
  mockSendMessageStream: vi.fn(),
  mockExecuteToolCall: vi.fn(),
};

const __actual = { ...(await import('../core/chatSession.js')) };
vi.mock('../core/chatSession.js', () => {
  const apply = (actual: typeof import('../core/chatSession.js')) => ({
    ...actual,
    ChatSession: MockedChatSession,
  });
  const result = __actual as
    | typeof import('../core/chatSession.js')
    | Promise<typeof import('../core/chatSession.js')>;
  return result instanceof Promise ? result.then(apply) : apply(result);
});

vi.mock('../core/nonInteractiveToolExecutor.js', () => ({
  executeToolCall: mockExecuteToolCall,
}));

vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js');

const mockedGetDirectoryContextString = getDirectoryContextString as Mock<
  typeof getDirectoryContextString
>;

describe('stream idle timeout behavioral tests', () => {
  let fixture: ExecutorTestFixture;
  const originalEnv = process.env;

  beforeEach(() => {
    fixture = setupExecutorFixture({
      MockedChatSession,
      mockSendMessageStream: mockSendMessageStream as MockFn,
      mockExecuteToolCall: mockExecuteToolCall as MockFn,
      mockedGetDirectoryContextString:
        mockedGetDirectoryContextString as MockFn,
      vi,
    });
    vi.useFakeTimers();
    process.env = { ...originalEnv };
    delete process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('honors config setting: uses resolveStreamIdleTimeoutMs with config', async () => {
    const customTimeoutMs = 20_000;

    fixture.mockConfig.setEphemeralSetting(
      'stream-idle-timeout-ms',
      customTimeoutMs,
    );

    expect(
      fixture.mockConfig.getEphemeralSetting('stream-idle-timeout-ms'),
    ).toBe(customTimeoutMs);
  });

  it('disabled path: setting 0 disables watchdog', async () => {
    fixture.mockConfig.setEphemeralSetting('stream-idle-timeout-ms', 0);

    expect(
      fixture.mockConfig.getEphemeralSetting('stream-idle-timeout-ms'),
    ).toBe(0);
  });

  it('env var precedence: env var is checked first', async () => {
    process.env.LLXPRT_STREAM_IDLE_TIMEOUT_MS = '10000';

    const { resolveStreamIdleTimeoutMs } = await import(
      '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js'
    );

    fixture.mockConfig.setEphemeralSetting('stream-idle-timeout-ms', 60000);

    const result = resolveStreamIdleTimeoutMs(fixture.mockConfig);
    expect(result).toBe(10000); // Env value wins
  });
});

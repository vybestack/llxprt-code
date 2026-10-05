/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as coreModule from '@vybestack/llxprt-code-core';
import { OutputFormat, JsonStreamEventType } from '@vybestack/llxprt-code-core';
import {
  formatNonInteractiveError,
  reportNonInteractiveError,
} from '../session/errorReporting.js';
import { dispatchInteractiveOrNonInteractive } from '../session/nonInteractiveSession.js';
import { installSafeProcessExit } from './sessionDispatch.testSeams.js';
import {
  createMinimalConfig,
  createMinimalSettings,
  createFakeAgent,
  dispatchTrace,
  renderCalls,
  mockWriteToStderr,
  TEST_SSH_AGENT_EMPTY_WARNING,
  findStartupWarningsProp,
  useDispatchRenderSeams,
} from './cliSessionDispatch.characterization.test-helpers.js';

function registerErrorOutputFirst(): void {
  describe('session-dispatch characterization — non-interactive error output / formatNonInteractiveError', () => {
    it('formatNonInteractiveError formats a plain Error via parseAndFormatApiError result', () => {
      const error = new Error('something went wrong');
      const formatted = formatNonInteractiveError(error);

      // Observable effect: the real formatter delegates to parseAndFormatApiError
      // first; for an Error with a message, that produces an [API Error: ...]
      // string containing the message, which formatNonInteractiveError returns
      // as-is (it does not fall through to error.stack).
      expect(formatted).toContain('something went wrong');
      expect(formatted).toContain('[API Error:');
    });

    it('formatNonInteractiveError formats a structured object via parseAndFormatApiError fallback', () => {
      const structured = { code: 500, detail: 'server failure' };
      const formatted = formatNonInteractiveError(structured);

      // Observable effect: parseAndFormatApiError does not recognize a plain
      // object as structured, so it returns the generic [API Error: An unknown
      // error occurred.] string, which formatNonInteractiveError returns as-is.
      expect(formatted).toContain('[API Error: An unknown error occurred.]');
    });

    it('formatNonInteractiveError formats a number primitive via parseAndFormatApiError fallback', () => {
      const formatted = formatNonInteractiveError(42);

      // Observable effect: parseAndFormatApiError returns the generic API-error
      // string for a number; formatNonInteractiveError returns it as-is.
      expect(formatted).toContain('[API Error: An unknown error occurred.]');
    });

    it('formatNonInteractiveError formats null via parseAndFormatApiError fallback', () => {
      const formatted = formatNonInteractiveError(null);

      // Observable effect: parseAndFormatApiError returns the generic API-error
      // string for null; formatNonInteractiveError returns it as-is.
      expect(formatted).toContain('[API Error: An unknown error occurred.]');
    });

    it('formatNonInteractiveError formats undefined via parseAndFormatApiError fallback', () => {
      const formatted = formatNonInteractiveError(undefined);

      // Observable effect: parseAndFormatApiError returns the generic API-error
      // string for undefined; formatNonInteractiveError returns it as-is.
      expect(formatted).toContain('[API Error: An unknown error occurred.]');
    });

    it('formatNonInteractiveError formats a TypeError via parseAndFormatApiError result', () => {
      const error = new TypeError('type mismatch');
      const formatted = formatNonInteractiveError(error);

      // Observable effect: parseAndFormatApiError recognizes the TypeError's
      // message and produces [API Error: type mismatch], which
      // formatNonInteractiveError returns as-is.
      expect(formatted).toContain('type mismatch');
      expect(formatted).toContain('[API Error:');
    });
  });
}

function registerErrorOutputRest(): void {
  describe.each([
    [
      'session-dispatch characterization — non-interactive error output / formatNonInteractiveError',
    ],
  ])('%s', () => {
    it('reportNonInteractiveError emits a structured stream-json error event', () => {
      const stdoutWrite = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const config = createMinimalConfig({
        interactive: false,
        outputFormat: OutputFormat.STREAM_JSON,
      });

      try {
        reportNonInteractiveError(config as never, new Error('stream failure'));

        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(mockWriteToStderr).toHaveBeenCalledTimes(1);
        const written = mockWriteToStderr.mock.calls[0][0];
        expect(typeof written).toBe('string');
        const event = JSON.parse(written as string);
        expect(event).toStrictEqual({
          type: JsonStreamEventType.ERROR,
          timestamp: expect.any(String),
          severity: 'error',
          message: expect.stringContaining('stream failure'),
        });
      } finally {
        stdoutWrite.mockRestore();
      }
    });

    it('reportNonInteractiveError emits json errors to stderr and not stdout', () => {
      const stdoutWrite = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const config = createMinimalConfig({
        interactive: false,
        outputFormat: OutputFormat.JSON,
      });

      try {
        reportNonInteractiveError(config as never, new Error('json failure'));

        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(mockWriteToStderr).toHaveBeenCalledTimes(1);
        const written = mockWriteToStderr.mock.calls[0][0];
        expect(typeof written).toBe('string');
        const envelope = JSON.parse(written as string);
        expect(envelope).toStrictEqual({
          error: {
            type: 'Error',
            message: 'json failure',
          },
        });
      } finally {
        stdoutWrite.mockRestore();
      }
    });

    it('reportNonInteractiveError emits plain text errors to stderr and not stdout', () => {
      const stdoutWrite = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const config = createMinimalConfig({
        interactive: false,
        outputFormat: 'text',
      });

      try {
        reportNonInteractiveError(config as never, new Error('plain failure'));

        expect(stdoutWrite).not.toHaveBeenCalled();
        expect(mockWriteToStderr).toHaveBeenCalledTimes(1);
        expect(mockWriteToStderr).toHaveBeenCalledWith(
          expect.stringContaining('Non-interactive run failed:'),
        );
        expect(mockWriteToStderr).toHaveBeenCalledWith(
          expect.stringContaining('plain failure'),
        );
      } finally {
        stdoutWrite.mockRestore();
      }
    });
  });
}

const originalEnv = process.env;

// Created per test: afterEach(vi.restoreAllMocks) would otherwise kill a
// suite-scoped spy after the first test.
function installStderrSpy() {
  return vi.spyOn(coreModule, 'writeToStderr').mockImplementation(() => true);
}
let stderrWriteSpy: ReturnType<typeof installStderrSpy>;

/** Runs dispatch with the fixed recording/stdin arguments these cases share. */
function runDispatch(config: unknown, settings: unknown) {
  return dispatchInteractiveOrNonInteractive({
    config: config as never,
    agent: createFakeAgent() as never,
    settings: settings as never,
    workspaceRoot: '/tmp/test',
    recording: {
      recordingIntegration: undefined,
      resumedBoot: undefined,
      recordingService: undefined,
      resumedLockHandle: null,
    } as never,
    hasPipedInput: false,
    readStdinData: async () => '',
  });
}

/** The startupWarnings array the TUI root was rendered with. */
function renderedStartupWarnings(): unknown[] | undefined {
  return renderCalls
    .map((args) => findStartupWarningsProp((args as unknown[])[0]))
    .find((warnings) => warnings !== undefined);
}

function wroteEmptyAgentWarning(): boolean {
  return stderrWriteSpy.mock.calls.some((call) =>
    String(call[0]).includes('SSH agent socket is present'),
  );
}

function registerSandboxWarningFirst(): void {
  describe('session-dispatch characterization — sandbox empty-agent handoff warning delivery', () => {
    beforeEach(() => {
      stderrWriteSpy = installStderrSpy();
      process.env = { ...originalEnv };
      dispatchTrace.length = 0;
      renderCalls.length = 0;
      installSafeProcessExit();
    });

    afterEach(() => {
      // Restore the original env object identity, not a copy, so a throwing
      // test cannot leak the substituted object or the handoff flag into
      // suites that run later in this worker.
      process.env = originalEnv;
      vi.restoreAllMocks();
    });

    it('pins the mocked handoff text to the warning the production preflight emits', async () => {
      // Imported lazily: referencing this binding from the hoisted vi.mock
      // factory above would read it before the module is evaluated.
      const { SSH_AGENT_EMPTY_WARNING } = await import(
        '../utils/sandbox-ssh.js'
      );
      expect(TEST_SSH_AGENT_EMPTY_WARNING).toBe(SSH_AGENT_EMPTY_WARNING);
    });

    it('interactive: prepends the empty-agent warning to the startup warnings rendered by the TUI when the env flag is set', async () => {
      process.env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY = '1';

      await runDispatch(
        createMinimalConfig({ interactive: true }),
        createMinimalSettings({ hideWindowTitle: true }),
      );

      expect(renderedStartupWarnings()?.[0]).toBe(TEST_SSH_AGENT_EMPTY_WARNING);
    });

    it('interactive: startup warnings are unchanged when the env flag is unset', async () => {
      delete process.env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY;

      await runDispatch(
        createMinimalConfig({ interactive: true }),
        createMinimalSettings({ hideWindowTitle: true }),
      );

      expect(renderedStartupWarnings()).toStrictEqual([]);
    });
  });
}

function registerSandboxWarningRest(): void {
  describe.each([
    [
      'session-dispatch characterization — sandbox empty-agent handoff warning delivery',
    ],
  ])('%s', () => {
    beforeEach(() => {
      stderrWriteSpy = installStderrSpy();
      process.env = { ...originalEnv };
      dispatchTrace.length = 0;
      renderCalls.length = 0;
      installSafeProcessExit();
    });

    afterEach(() => {
      // Restore the original env object identity, not a copy, so a throwing
      // test cannot leak the substituted object or the handoff flag into
      // suites that run later in this worker.
      process.env = originalEnv;
      vi.restoreAllMocks();
    });

    it('non-interactive: writes the empty-agent warning to stderr before the session runs when the env flag is set', async () => {
      process.env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY = '1';

      // Sampling the dispatch trace at the moment of the write puts both
      // events on one timeline, so a regression that warned only after the
      // session ran would be caught.
      const order: string[] = [];
      stderrWriteSpy.mockImplementation((chunk: unknown) => {
        if (String(chunk) === TEST_SSH_AGENT_EMPTY_WARNING) {
          order.push(...dispatchTrace, 'warning');
        }
        return true;
      });

      await expect(
        runDispatch(
          createMinimalConfig({ interactive: false, question: 'prompt' }),
          createMinimalSettings(),
        ),
      ).rejects.toThrow('process.exit');

      // The warning was the only event on the timeline when it was written:
      // runNonInteractive had not run yet, and it did run afterwards.
      expect(order).toStrictEqual(['warning']);
      expect(dispatchTrace).toContain('runNonInteractive');
    });

    it('non-interactive: withholds the handoff warning in JSON output mode so it cannot reach the payload stream', async () => {
      process.env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY = '1';

      await expect(
        runDispatch(
          createMinimalConfig({
            interactive: false,
            question: 'prompt',
            outputFormat: OutputFormat.JSON,
          }),
          createMinimalSettings(),
        ),
      ).rejects.toThrow('process.exit');

      expect(wroteEmptyAgentWarning()).toBe(false);
      expect(dispatchTrace).toContain('runNonInteractive');
    });

    it('non-interactive: writes nothing for the handoff when the env flag is unset', async () => {
      delete process.env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY;

      await expect(
        runDispatch(
          createMinimalConfig({ interactive: false, question: 'prompt' }),
          createMinimalSettings(),
        ),
      ).rejects.toThrow('process.exit');

      expect(wroteEmptyAgentWarning()).toBe(false);
      expect(dispatchTrace).toContain('runNonInteractive');
    });
  });
}

describe('session-dispatch characterization', () => {
  useDispatchRenderSeams();
  afterEach(() => {
    vi.restoreAllMocks();
  });
  registerErrorOutputFirst();
  registerErrorOutputRest();
  registerSandboxWarningFirst();
  registerSandboxWarningRest();
});

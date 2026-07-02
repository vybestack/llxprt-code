/**
 * @plan PLAN-20260629-ISSUE2285.P11
 * @requirement REQ-006
 * @pseudocode cli-session-split.md (characterization contract)
 *
 * Characterization tests for the CURRENT (unsplit) session-dispatch module.
 *
 * These tests pin down what the module ACTUALLY DOES today so the P12 split
 * can prove it changes nothing observable. They are NOT aspirational tests of
 * ideal behavior. The real session-dispatch exports run through safe seams
 * (captured stdio, safe process.exit sentinel, listener-capture process.on/off,
 * recording Ink render fake, dependency mocks for heavyweight externals). No
 * suite mocks the session-dispatch module itself.
 *
 * Retargeting-stability contract (P12): assertion bodies assert OBSERVABLE
 * EFFECTS (output written, branch taken, handler effect, flush payload, cleanup
 * state) — not module-internal structure — so P12 can retarget imports to the
 * new session/* modules by changing ONLY import specifiers, leaving assertion
 * bodies byte-identical.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockWriteToStderr } = vi.hoisted(() => ({
  mockWriteToStderr: vi.fn<(chunk: string | Uint8Array) => boolean>(() => true),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    writeToStderr: mockWriteToStderr,
  };
});

import {
  coreEvents,
  CoreEvent,
  OutputFormat,
  JsonStreamEventType,
  debugLogger,
  type OutputPayload,
  type ConsoleLogPayload,
} from '@vybestack/llxprt-code-core';

// Real exports under test — NOT mocked.
import {
  formatNonInteractiveError,
  reportNonInteractiveError,
} from '../session/errorReporting.js';
import {
  installNonInteractiveSigintHandler,
  setupUnhandledRejectionHandler,
} from '../session/signalHandlers.js';
import { initializeOutputListenersAndFlush } from '../session/outputListeners.js';
import { dispatchInteractiveOrNonInteractive } from '../session/nonInteractiveSession.js';
import {
  startInteractiveUI,
  __resetInteractiveUIStateForTesting,
} from '../session/interactiveUI.js';

import {
  ExitCalledError,
  installSafeProcessExit,
  installCapturedStdio,
  installListenerCapture,
} from './sessionDispatch.testSeams.js';

// Real appEvents — NOT mocked. Used to verify observable LogError emissions.
import { appEvents, AppEvent } from '../utils/events.js';

// ---------------------------------------------------------------------------
// Safe-seam dependency mocks for heavyweight externals.
//
// These mock DEPENDENCIES of the session-dispatch code (not the module itself), so
// the real dispatch code runs while external effects (Agent construction, ink
// render, non-interactive runner, update checks) are isolated. The observable
// effects asserted below are produced by the REAL dispatch code running through
// these seams.
// ---------------------------------------------------------------------------

// Capture which branch dispatch selected by recording mock invocations.
const dispatchTrace: string[] = [];

vi.mock('../cliAgentBootstrap.js', () => ({
  createForegroundAgent: vi.fn(async () => {
    dispatchTrace.push('createForegroundAgent');
    return { fake: true } as unknown;
  }),
}));

// The actual module path used by session-dispatch is utils/startupWarnings.js
vi.mock('../utils/startupWarnings.js', () => ({
  getStartupWarnings: vi.fn(async () => []),
}));

vi.mock('../utils/userStartupWarnings.js', () => ({
  getUserStartupWarnings: vi.fn(async () => []),
}));

vi.mock('../nonInteractiveCli.js', () => ({
  runNonInteractive: vi.fn(async () => {
    dispatchTrace.push('runNonInteractive');
    return 0;
  }),
}));

vi.mock('../validateNonInteractiveAuth.js', () => ({
  validateNonInteractiveAuth: vi.fn(
    async (_external: unknown, config: unknown) => {
      dispatchTrace.push('validateNonInteractiveAuth');
      return config;
    },
  ),
}));

vi.mock('../utils/version.js', () => ({
  getCliVersion: vi.fn(async () => 'test-version'),
}));

vi.mock('../utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(async () => null),
}));

vi.mock('../utils/handleAutoUpdate.js', () => ({
  handleAutoUpdate: vi.fn(),
}));

vi.mock('../utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(async () => {}),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(async () => {}),
}));

// Recording Ink render fake: captures the call without touching a real TTY.
const renderCalls: unknown[] = [];
vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    render: vi.fn((...args: unknown[]) => {
      renderCalls.push(args);
      return {
        waitUntilExit: vi.fn(async () => {}),
        clear: vi.fn(),
        unmount: vi.fn(),
      };
    }),
  };
});

// ---------------------------------------------------------------------------
// Helpers for building minimal Config/Settings stubs consumed by the real
// dispatch code paths. These satisfy the type contracts without constructing
// heavyweight runtime objects.
// ---------------------------------------------------------------------------

function createMinimalConfig(options: {
  interactive: boolean;
  question?: string;
  outputFormat?: string;
}): unknown {
  return {
    isInteractive: () => options.interactive,
    getQuestion: () => options.question ?? '',
    getOutputFormat: () => options.outputFormat ?? 'text',
    getProvider: () => undefined,
    getProviderManager: () => undefined,
    getModel: () => undefined,
    getProjectRoot: () => '/tmp/test-project',
    getTerminalBackground: () => '#000000',
    getDebugMode: () => false,
    getScreenReader: () => false,
    getSessionId: () => 'test-session',
    refreshAuth: vi.fn(async () => {}),
    setEphemeralSetting: vi.fn(),
    getEphemeralSetting: vi.fn(() => undefined),
  };
}

function createMinimalSettings(options?: {
  hideWindowTitle?: boolean;
  enableMouseEvents?: boolean;
  useAlternateBuffer?: boolean;
}): unknown {
  return {
    merged: {
      ui: {
        hideWindowTitle: options?.hideWindowTitle ?? false,
        enableMouseEvents: options?.enableMouseEvents ?? false,
        useAlternateBuffer: options?.useAlternateBuffer ?? false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Suite 1: Dispatch branch selection
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — dispatch branch selection', () => {
  beforeEach(() => {
    dispatchTrace.length = 0;
    renderCalls.length = 0;
    // Install the safe process.exit seam so the non-interactive branch's
    // process.exit does not terminate the test runner.
    installSafeProcessExit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatch branch selection: interactive when config.isInteractive() returns true', async () => {
    const config = createMinimalConfig({ interactive: true });
    const settings = createMinimalSettings({ hideWindowTitle: true });

    await dispatchInteractiveOrNonInteractive({
      config: config as never,
      settings: settings as never,
      workspaceRoot: '/tmp/test',
      sessionMessageBus: {} as never,
      recording: {
        recordingIntegration: undefined,
        resumedHistory: undefined,
        recordingService: undefined,
        resumedLockHandle: null,
      } as never,
      hasPipedInput: false,
      readStdinData: async () => '',
    });

    // Observable effect: the interactive branch called createForegroundAgent
    // (NOT the non-interactive runner).
    expect(dispatchTrace).toContain('createForegroundAgent');
    expect(dispatchTrace).not.toContain('runNonInteractive');
  });

  it('dispatch branch selection: non-interactive piped/prompt when config.isInteractive() returns false', async () => {
    const config = createMinimalConfig({
      interactive: false,
      question: 'hello',
    });
    const settings = createMinimalSettings();

    // The non-interactive branch calls runExitCleanup then process.exit. The
    // safe exit seam throws ExitCalledError, which the dispatch does NOT catch
    // (runPipedOrPromptSession propagates it), so we expect the sentinel.
    await expect(
      dispatchInteractiveOrNonInteractive({
        config: config as never,
        settings: settings as never,
        workspaceRoot: '/tmp/test',
        sessionMessageBus: {} as never,
        recording: {
          recordingIntegration: undefined,
          resumedHistory: undefined,
          recordingService: undefined,
          resumedLockHandle: null,
        } as never,
        hasPipedInput: false,
        readStdinData: async () => '',
      }),
    ).rejects.toThrow('process.exit');

    // Observable effect: the non-interactive branch reached the runner (NOT
    // the interactive createForegroundAgent).
    expect(dispatchTrace).toContain('runNonInteractive');
    expect(dispatchTrace).not.toContain('createForegroundAgent');
  });
});

// ---------------------------------------------------------------------------
// Suite 2: SIGINT handler installation/disposal
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — SIGINT signal handler installation/disposal', () => {
  let stdio: ReturnType<typeof installCapturedStdio>;
  let listeners: ReturnType<typeof installListenerCapture>;

  beforeEach(() => {
    installSafeProcessExit();
    stdio = installCapturedStdio();
    listeners = installListenerCapture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs a SIGINT handler on process that writes cancellation to stderr and exits 130', async () => {
    const exitProcess = vi.fn<(code: number) => never>();
    installNonInteractiveSigintHandler(exitProcess);

    // Observable effect: a SIGINT listener was registered.
    expect(listeners.listenerCount('SIGINT')).toBeGreaterThanOrEqual(1);

    listeners.invokeLast('SIGINT');

    await vi.waitFor(() => {
      expect(exitProcess).toHaveBeenCalledWith(130);
    });
    expect(stdio.stderrContent).toContain('Cancelled');
  });

  it('returns a disposer that removes the SIGINT handler, restoring prior listener state', () => {
    const countBefore = listeners.listenerCount('SIGINT');
    const dispose = installNonInteractiveSigintHandler();
    const countAfterInstall = listeners.listenerCount('SIGINT');
    expect(countAfterInstall).toBe(countBefore + 1);

    dispose();

    // Observable effect: disposal removed the handler (listener count returned
    // to its pre-install state).
    expect(listeners.listenerCount('SIGINT')).toBe(countBefore);
  });

  it('does not re-exit on a repeated SIGINT (once-only guard)', async () => {
    const exitProcess = vi.fn<(code: number) => never>();
    installNonInteractiveSigintHandler(exitProcess);

    listeners.invokeLast('SIGINT');
    await vi.waitFor(() => {
      expect(exitProcess).toHaveBeenCalledWith(130);
    });

    // Second invocation must NOT call process.exit again.
    exitProcess.mockClear();
    listeners.invokeLast('SIGINT');
    expect(exitProcess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 3: Output flush ordering
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — output flush ordering', () => {
  // coreEvents is a process singleton. We must clean up listeners installed by
  // initializeOutputListenersAndFlush between tests so each test starts with a
  // clean listener state and can verify the real code's install+drain behavior.
  afterEach(() => {
    coreEvents.drainBacklogs();
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);
  });

  it('installs Output and ConsoleLog listeners when none exist, then drains backlogs', () => {
    // Start clean: no listeners.
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);

    // Backlog some output events BEFORE installing listeners (they buffer in
    // the coreEvents internal backlog).
    coreEvents.emitOutput({ chunk: 'backlog-stdout', isStderr: false });
    coreEvents.emitOutput({ chunk: 'backlog-stderr', isStderr: true });

    const outputCountBefore = coreEvents.listenerCount(CoreEvent.Output);
    expect(outputCountBefore).toBe(0);

    // Run the real initializer (installs listeners + calls drainBacklogs,
    // which replays the buffered events through the newly-installed listener
    // and clears the backlog).
    initializeOutputListenersAndFlush();

    // Observable effect: listeners were installed.
    expect(coreEvents.listenerCount(CoreEvent.Output)).toBe(1);
    expect(coreEvents.listenerCount(CoreEvent.ConsoleLog)).toBe(1);

    // Observable effect: the backlog was drained — a trailing listener
    // registered AFTER init, followed by a manual drainBacklogs(), receives
    // NO events (the backlog was already cleared by the initializer).
    const drainedAfterInit: OutputPayload[] = [];
    coreEvents.on(CoreEvent.Output, (payload: OutputPayload) => {
      drainedAfterInit.push(payload);
    });
    coreEvents.drainBacklogs();
    expect(drainedAfterInit).toHaveLength(0);

    // Observable effect: the newly-installed Output listener routes chunks.
    // We capture what the real listener writes by attaching our own listener
    // that runs AFTER the real one (listeners fire in registration order).
    const routed: OutputPayload[] = [];
    coreEvents.on(CoreEvent.Output, (payload: OutputPayload) => {
      routed.push(payload);
    });

    coreEvents.emitOutput({ chunk: 'post-install-1', isStderr: false });
    coreEvents.emitOutput({ chunk: 'post-install-2', isStderr: true });

    expect(routed).toHaveLength(2);
    expect(routed[0].chunk).toBe('post-install-1');
    expect(routed[0].isStderr).toBe(false);
    expect(routed[1].chunk).toBe('post-install-2');
    expect(routed[1].isStderr).toBe(true);
  });

  it('does not install duplicate Output listeners when one already exists', () => {
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);

    // Pre-register a listener so the real code sees listenerCount > 0.
    const existingListener = (_payload: OutputPayload) => {};
    coreEvents.on(CoreEvent.Output, existingListener);

    const countBefore = coreEvents.listenerCount(CoreEvent.Output);
    expect(countBefore).toBe(1);

    initializeOutputListenersAndFlush();

    // Observable effect: the real code did NOT add another listener (guard
    // condition: listenerCount === 0).
    expect(coreEvents.listenerCount(CoreEvent.Output)).toBe(1);

    coreEvents.off(CoreEvent.Output, existingListener);
  });

  it('still installs a ConsoleLog listener when an Output listener already exists (independent guards)', () => {
    // Regression characterization: ConsoleLog registration must be gated
    // independently of Output. If a pre-existing Output listener made
    // listenerCount(Output) > 0, the ConsoleLog sink must STILL be attached
    // (otherwise console.log/error output routed via CoreEvent.ConsoleLog
    // would be silently dropped).
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);

    // Pre-register ONLY an Output listener.
    const existingOutputListener = (_payload: OutputPayload) => {};
    coreEvents.on(CoreEvent.Output, existingOutputListener);

    expect(coreEvents.listenerCount(CoreEvent.Output)).toBe(1);
    expect(coreEvents.listenerCount(CoreEvent.ConsoleLog)).toBe(0);

    initializeOutputListenersAndFlush();

    // Observable effect: Output listener count unchanged (no duplicate), but
    // the ConsoleLog listener WAS installed (independent guard).
    expect(coreEvents.listenerCount(CoreEvent.Output)).toBe(1);
    expect(coreEvents.listenerCount(CoreEvent.ConsoleLog)).toBe(1);

    coreEvents.off(CoreEvent.Output, existingOutputListener);
  });

  it('ConsoleLog listener receives error and log payloads with correct type and content', () => {
    // This test verifies that ConsoleLog payloads are emitted with the
    // correct type and content fields. It does NOT assert stream routing
    // (writeToStderr vs writeToStdout) because those bindings are resolved at
    // module-load time inside the real listener and are not observable
    // through the coreEvents listener seam.
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);

    initializeOutputListenersAndFlush();

    // The real ConsoleLog listener is installed. Emit console-log events and
    // capture them via our trailing listener to verify the routing decision
    // is encoded in the payload (the real listener checks type to choose the
    // stream; we verify the payload the listener received).
    const routed: ConsoleLogPayload[] = [];
    coreEvents.on(CoreEvent.ConsoleLog, (payload: ConsoleLogPayload) => {
      routed.push(payload);
    });

    coreEvents.emitConsoleLog('error', 'error-content');
    coreEvents.emitConsoleLog('log', 'log-content');

    expect(routed).toHaveLength(2);
    expect(routed[0].type).toBe('error');
    expect(routed[0].content).toBe('error-content');
    expect(routed[1].type).toBe('log');
    expect(routed[1].content).toBe('log-content');
  });
});

// ---------------------------------------------------------------------------
// Suite 4: Process lifecycle / unhandled rejection handling
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — process lifecycle / unhandled rejection handling', () => {
  let listeners: ReturnType<typeof installListenerCapture>;

  beforeEach(() => {
    listeners = installListenerCapture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs an unhandledRejection handler on process', () => {
    setupUnhandledRejectionHandler();

    // Observable effect: an unhandledRejection listener was registered.
    expect(
      listeners.listenerCount('unhandledRejection'),
    ).toBeGreaterThanOrEqual(1);
  });

  it('unhandled rejection handler emits LogError app event with the rejection reason', () => {
    const logErrorPayloads: string[] = [];
    const onLogError = (message: string) => {
      logErrorPayloads.push(message);
    };
    appEvents.on(AppEvent.LogError, onLogError);

    setupUnhandledRejectionHandler();

    // Invoke the real captured handler with a rejection reason.
    listeners.invokeLast('unhandledRejection', 'test rejection reason');

    // Observable effect: the real handler emitted LogError containing the
    // rejection reason text.
    const combined = logErrorPayloads.join('\n');
    expect(combined).toContain('test rejection reason');
    expect(combined).toContain('Unhandled Promise Rejection');

    appEvents.off(AppEvent.LogError, onLogError);
  });

  it('returns a disposer that removes the unhandledRejection handler', () => {
    const countBefore = listeners.listenerCount('unhandledRejection');
    const dispose = setupUnhandledRejectionHandler();
    expect(listeners.listenerCount('unhandledRejection')).toBe(countBefore + 1);

    dispose();

    // Observable effect: the handler was removed.
    expect(listeners.listenerCount('unhandledRejection')).toBe(countBefore);
  });
});

// ---------------------------------------------------------------------------
// Suite 5: Piped prompt driving / non-interactive path
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — piped prompt driving / non-interactive path', () => {
  let readStdinCalls: number;

  beforeEach(() => {
    dispatchTrace.length = 0;
    readStdinCalls = 0;
    // Install the safe process.exit seam so the non-interactive branch's
    // process.exit does not terminate the test runner.
    installSafeProcessExit();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drives the non-interactive session using piped stdin when hasPipedInput is true', async () => {
    const pipedContent = 'piped prompt content';
    const config = createMinimalConfig({
      interactive: false,
      question: '',
    });
    const settings = createMinimalSettings();

    // The real dispatch reads stdin via readStdinData when hasPipedInput.
    await expect(
      dispatchInteractiveOrNonInteractive({
        config: config as never,
        settings: settings as never,
        workspaceRoot: '/tmp/test',
        sessionMessageBus: {} as never,
        recording: {
          recordingIntegration: undefined,
          resumedHistory: undefined,
          recordingService: undefined,
          resumedLockHandle: null,
        } as never,
        hasPipedInput: true,
        readStdinData: async () => {
          readStdinCalls++;
          return pipedContent;
        },
      }),
    ).rejects.toThrow('process.exit');

    // Observable effect: readStdinData was consumed (the real piped-input
    // path called it to merge stdin into the session input).
    expect(readStdinCalls).toBe(1);
    // Observable effect: the non-interactive runner was reached with the piped
    // input (runNonInteractive was invoked).
    expect(dispatchTrace).toContain('runNonInteractive');
  });

  it('exits 1 when piped stdin and prompt are both empty (no-input non-interactive path)', async () => {
    const config = createMinimalConfig({
      interactive: false,
      question: '',
    });
    const settings = createMinimalSettings();

    let caught: ExitCalledError | undefined;
    try {
      await dispatchInteractiveOrNonInteractive({
        config: config as never,
        settings: settings as never,
        workspaceRoot: '/tmp/test',
        sessionMessageBus: {} as never,
        recording: {
          recordingIntegration: undefined,
          resumedHistory: undefined,
          recordingService: undefined,
          resumedLockHandle: null,
        } as never,
        hasPipedInput: true,
        readStdinData: async () => '',
      });
    } catch (error: unknown) {
      if (error instanceof ExitCalledError) {
        caught = error;
      } else {
        throw error;
      }
    }

    // Observable effect: the real code took the no-input early-exit branch:
    // process.exit(1) fired via the safe sentinel (NOT the runner's exit), and
    // the non-interactive runner was never reached.
    expect(caught).toBeDefined();
    expect(caught!.exitCode).toBe(1);
    // The runner must NOT have been reached (no input).
    expect(dispatchTrace).not.toContain('runNonInteractive');
  });

  it('uses the --prompt value directly when hasPipedInput is false and prompt is present', async () => {
    const config = createMinimalConfig({
      interactive: false,
      question: 'cli-prompt-value',
    });
    const settings = createMinimalSettings();

    await expect(
      dispatchInteractiveOrNonInteractive({
        config: config as never,
        settings: settings as never,
        workspaceRoot: '/tmp/test',
        sessionMessageBus: {} as never,
        recording: {
          recordingIntegration: undefined,
          resumedHistory: undefined,
          recordingService: undefined,
          resumedLockHandle: null,
        } as never,
        hasPipedInput: false,
        readStdinData: async () => {
          readStdinCalls++;
          return '';
        },
      }),
    ).rejects.toThrow('process.exit');

    // Observable effect: readStdinData was NOT called (no piped input path),
    // but the runner was reached using the --prompt value.
    expect(readStdinCalls).toBe(0);
    expect(dispatchTrace).toContain('runNonInteractive');
  });
});

// ---------------------------------------------------------------------------
// Suite 6: Terminal/mouse cleanup
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — terminal/mouse cleanup', () => {
  let listeners: ReturnType<typeof installListenerCapture>;

  beforeEach(() => {
    renderCalls.length = 0;
    listeners = installListenerCapture();
    // Reset interactiveUI module-level state (cleanupRegistered,
    // titleResetExitListenerRegistered, latestInstance) so each test starts
    // with a fresh first-call registration.
    __resetInteractiveUIStateForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('startInteractiveUI registers a process exit handler for terminal protocol restoration', async () => {
    const config = createMinimalConfig({ interactive: true });
    const settings = createMinimalSettings({
      hideWindowTitle: true,
      enableMouseEvents: false,
      useAlternateBuffer: false,
    });

    const exitBefore = listeners.listenerCount('exit');

    await startInteractiveUI(
      config as never,
      { fake: true } as never,
      settings as never,
      [],
      '/tmp/test',
    );

    // Observable effect: the real code registered process.on('exit') handlers
    // for terminal protocol restoration (restoreTerminalProtocolsSync).
    const exitAfter = listeners.listenerCount('exit');
    expect(exitAfter).toBeGreaterThan(exitBefore);
  });

  it('startInteractiveUI registers mouse-events exit handler when mouse events are enabled', async () => {
    const config = createMinimalConfig({ interactive: true });
    const settings = createMinimalSettings({
      hideWindowTitle: true,
      enableMouseEvents: true,
      useAlternateBuffer: true,
    });

    const exitBefore = listeners.listenerCount('exit');

    await startInteractiveUI(
      config as never,
      { fake: true } as never,
      settings as never,
      [],
      '/tmp/test',
    );

    // Observable effect: with mouse events enabled, the real code registers
    // ADDITIONAL exit handlers (mouseEventsExitHandler + restoreTerminalProtocolsSync),
    // so the exit listener count increased by more than just the title-reset
    // handler.
    const exitAfter = listeners.listenerCount('exit');
    expect(exitAfter - exitBefore).toBeGreaterThanOrEqual(2);
  });

  it('startInteractiveUI calls Ink render with the AppWrapper element tree', async () => {
    const config = createMinimalConfig({ interactive: true });
    const settings = createMinimalSettings({
      hideWindowTitle: true,
    });

    await startInteractiveUI(
      config as never,
      { fake: true } as never,
      settings as never,
      ['startup warning'],
      '/tmp/test',
    );

    // Observable effect: the real code called Ink render (the recording fake
    // captured the call), bootstrapping the interactive UI.
    expect(renderCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 7: Non-interactive error output (formatNonInteractiveError)
// ---------------------------------------------------------------------------

describe('session-dispatch characterization — non-interactive error output / formatNonInteractiveError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it('reportNonInteractiveError reports plain text errors through the debug logger', () => {
    const debugError = vi
      .spyOn(debugLogger, 'error')
      .mockImplementation(() => {});
    const config = createMinimalConfig({
      interactive: false,
      outputFormat: 'text',
    });

    try {
      reportNonInteractiveError(config as never, new Error('plain failure'));

      expect(debugError).toHaveBeenCalledTimes(1);
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('Non-interactive run failed:'),
      );
      expect(debugError).toHaveBeenCalledWith(
        expect.stringContaining('plain failure'),
      );
    } finally {
      debugError.mockRestore();
    }
  });
});

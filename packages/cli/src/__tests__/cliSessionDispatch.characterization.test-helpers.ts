/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { vi } from 'bun:test';
import { __setWriteToStderrForTesting } from '../session/errorReporting.js';
import { __setRenderForTesting } from '../session/interactiveUI.js';

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
export const dispatchTrace: string[] = [];

void vi.mock('../cliAgentBootstrap.js', () => ({
  createForegroundAgent: vi.fn(async () => {
    dispatchTrace.push('createForegroundAgent');
    return { fake: true } as unknown;
  }),
}));

// The actual module path used by session-dispatch is utils/startupWarnings.js
export const TEST_SSH_AGENT_EMPTY_WARNING =
  [
    'SSH agent socket is present, but no identities are loaded (ssh-add -l reported empty).',
    'SSH forwarding is enabled, but git SSH auth will fail until a key is loaded.',
    'Try: ssh-add ~/.ssh/id_ed25519',
  ].join('\n') + '\n';
void vi.mock('../utils/startupWarnings.js', () => ({
  getStartupWarnings: vi.fn(async () => []),
  getSandboxHandoffWarning: vi.fn((env: NodeJS.ProcessEnv) =>
    env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY === '1'
      ? TEST_SSH_AGENT_EMPTY_WARNING
      : undefined,
  ),
}));

void vi.mock('../utils/userStartupWarnings.js', () => ({
  getUserStartupWarnings: vi.fn(async () => []),
}));

void vi.mock('../nonInteractiveCli.js', () => ({
  runNonInteractive: vi.fn(async () => {
    dispatchTrace.push('runNonInteractive');
    return 0;
  }),
}));

void vi.mock('../validateNonInteractiveAuth.js', () => ({
  validateNonInteractiveAuth: vi.fn(
    async (_external: unknown, config: unknown) => {
      dispatchTrace.push('validateNonInteractiveAuth');
      return config;
    },
  ),
}));

void vi.mock('../utils/version.js', () => ({
  getCliVersion: vi.fn(async () => 'test-version'),
}));

void vi.mock('../ui/utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(async () => null),
}));

void vi.mock('../utils/handleAutoUpdate.js', () => ({
  handleAutoUpdate: vi.fn(),
}));

void vi.mock('../utils/cleanup.js', () => ({
  cleanupCheckpoints: vi.fn(async () => {}),
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
  runExitCleanup: vi.fn(async () => {}),
}));

// Recording Ink render fake: captures the call without touching a real TTY.
// Uses the __setRenderForTesting seam in interactiveUI.tsx instead of
// module mocking, which deadlocks during module evaluation under Bun.
export const renderCalls: unknown[] = [];

/**
 * Walks the rendered React element tree (StrictMode → ErrorBoundary →
 * SettingsContext.Provider → AppWrapper) to the startupWarnings prop, exposing
 * the warnings array delivered to the TUI root as an observable effect.
 */
export function findStartupWarningsProp(node: unknown): unknown[] | undefined {
  if (node === null || node === undefined || typeof node !== 'object') {
    return undefined;
  }
  const el = node as { props?: Record<string, unknown> };
  const props = el.props;
  if (props) {
    if (Array.isArray(props.startupWarnings)) {
      return props.startupWarnings;
    }
    const childProps = (props as { children?: unknown }).children;
    const viaChildren = Array.isArray(childProps)
      ? childProps
          .map(findStartupWarningsProp)
          .find((found) => found !== undefined)
      : findStartupWarningsProp(childProps);
    if (viaChildren !== undefined) return viaChildren;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Helpers for building minimal Config/Settings stubs consumed by the real
// dispatch code paths. These satisfy the type contracts without constructing
// heavyweight runtime objects.
// ---------------------------------------------------------------------------

export function createMinimalConfig(options: {
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
    getTelemetrySettings: () => ({ perf: { enabled: false, memory: false } }),
  };
}

export function createMinimalSettings(options?: {
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

// #2378: dispatch no longer constructs the Agent — the composition root builds
// the single Agent and passes it in. The dispatch reads the session bus via
// agent.getMessageBus(), so the minimal fake exposes that accessor. tools.get
// is present for the non-interactive @-command fallback path.
//
// The non-interactive run drives SessionStart through the Agent's own hooks
// surface (agent.hooks.triggerSessionStart()), so the fake exposes that hook
// returning an empty output object ({} — no systemMessage/additionalContext).
// Without it the runner throws before reaching runNonInteractive and the
// dispatch-branch traces would never record the runner.
export function createFakeAgent(): unknown {
  return {
    getMessageBus: () => ({}) as never,
    hooks: {
      triggerSessionStart: vi.fn(async () => ({})),
    },
    tools: { get: () => undefined },
    dispose: vi.fn(async () => {}),
  };
}

export const mockWriteToStderr = vi.fn<(chunk: string | Uint8Array) => boolean>(
  () => true,
);

export function useDispatchRenderSeams(): void {
  beforeEach(() => {
    mockWriteToStderr.mockClear();
  });
  beforeAll(() => {
    __setWriteToStderrForTesting(mockWriteToStderr);
    __setRenderForTesting((...args: unknown[]) => {
      renderCalls.push(args);
      return {
        waitUntilExit: vi.fn(async () => {}),
        clear: vi.fn(),
        rerender: vi.fn(),
        unmount: vi.fn(),
      } as never;
    });
  });
  afterAll(() => {
    __setRenderForTesting(null);
    __setWriteToStderrForTesting(null);
  });
}

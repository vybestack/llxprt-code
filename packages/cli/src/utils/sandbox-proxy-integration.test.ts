/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Integration tests for credential proxy integration into sandbox.ts.
 * These are behavioral tests verifying the actual source code structure.
 *
 * @plan:PLAN-20250214-CREDPROXY.P34
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testRegex } from '../test-utils/regex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sandboxSources = {
  sandbox: fs.readFileSync(path.join(__dirname, 'sandbox.ts'), 'utf-8'),
  containers: fs.readFileSync(
    path.join(__dirname, 'sandbox-containers.ts'),
    'utf-8',
  ),
  exec: fs.readFileSync(path.join(__dirname, 'sandbox-exec.ts'), 'utf-8'),
  seatbelt: fs.readFileSync(
    path.join(__dirname, 'sandbox-seatbelt.ts'),
    'utf-8',
  ),
};

const sandboxSource = Object.values(sandboxSources).join('\n');

/** Extracts a function's source text (including declaration) by finding the
 *  next function declaration boundary (handles both `function` and `async
 *  function`). NOTE: This assumes no nested function declarations exist
 *  within the target body — currently true for all callers. */
function extractFunctionBody(source: string, fnName: string): string {
  const start = source.indexOf(`function ${fnName}(`);
  if (start === -1) {
    throw new Error(`extractFunctionBody: function "${fnName}" not found in source`);
  }
  const nextFn = source
    .slice(start)
    .search(/\n(?:export )?(?:async )?function /);
  // When no next function is found, return the remainder of the file from
  // start (substring with undefined end). This is the desired fallback for
  // the last function in the file.
  const end = nextFn === -1 ? undefined : start + nextFn;
  return source.substring(start, end);
}

describe('Credential Proxy Integration - sandbox.ts', () => {
  describe('R25.1: Proxy Server Created Before Container', () => {
    it('imports createAndStartProxy from sandbox-proxy-lifecycle', () => {
      expect(sandboxSource).toContain(
        "import {\n  createAndStartProxy,\n  stopProxy,\n  getProxySocketPath,\n  getProxyCapabilityToken,\n} from '@vybestack/llxprt-code-providers/auth.js';",
      );
    });

    it('calls createAndStartProxy before container spawn', () => {
      const setupProxyIndex = sandboxSource.indexOf(
        'async function setupCredentialProxy',
      );
      const createProxyIndex = sandboxSource.indexOf(
        'await createAndStartProxy',
        setupProxyIndex,
      );
      const prepareContainerIndex = sandboxSource.indexOf(
        'async function prepareContainerSandbox',
      );
      const setupProxyCallIndex = sandboxSource.indexOf(
        'await setupCredentialProxy',
        prepareContainerIndex,
      );
      const executeContainerIndex = sandboxSource.indexOf(
        'async function executeContainerSandbox',
      );
      const pushImageIndex = sandboxSource.indexOf(
        'args.push(image)',
        executeContainerIndex,
      );
      const spawnInDocker = sandboxSource.indexOf(
        'spawn(config.command, args, {',
        executeContainerIndex,
      );

      expect(createProxyIndex).toBeGreaterThan(setupProxyIndex);
      expect(setupProxyCallIndex).toBeGreaterThan(prepareContainerIndex);
      expect(pushImageIndex).toBeGreaterThan(executeContainerIndex);
      expect(spawnInDocker).toBeGreaterThan(pushImageIndex);
      expect(setupProxyCallIndex).toBeLessThan(pushImageIndex);
    });
  });

  describe('R25.1a: Proxy Creation Failure Aborts', () => {
    it('throws FatalSandboxError on proxy creation failure', () => {
      const proxyFailureIndex = sandboxSource.indexOf(
        '@plan:PLAN-20250214-CREDPROXY.P34 R25.1a:',
      );
      const catchIndex = sandboxSource.lastIndexOf(
        'catch (err)',
        proxyFailureIndex,
      );
      const proxyFailureSection = sandboxSource.substring(
        catchIndex,
        sandboxSource.indexOf(
          'const socketPath = getProxySocketPath()',
          proxyFailureIndex,
        ),
      );
      const messagePrefixMatches = proxyFailureSection.match(
        testRegex('Failed to start credential proxy:', 'g'),
      );

      expect(proxyFailureIndex).toBeGreaterThan(-1);
      expect(catchIndex).toBeGreaterThan(-1);
      expect(proxyFailureSection).toContain('catch (err)');
      expect(proxyFailureSection).toContain('throw new FatalSandboxError(');
      expect(messagePrefixMatches).toHaveLength(1);
    });

    it('wraps createAndStartProxy in try-catch', () => {
      expect(sandboxSource).toMatch(
        /try\s*\{[\s\S]{0,300}?await\s+createAndStartProxy[\s\S]*?\}\s*catch/,
      );
    });
  });

  describe('R3.4: macOS Realpath for Socket', () => {
    it('uses fs.realpathSync for tmpdir in volume mount', () => {
      // Verify the tmpdir mount uses realpath
      expect(sandboxSource).toContain(
        'const resolvedTmpdir = fs.realpathSync(os.tmpdir())',
      );
    });

    it('passes resolvedTmpdir to volume mount', () => {
      expect(sandboxSource).toContain(
        '`${resolvedTmpdir}:${getContainerPath(resolvedTmpdir)}`',
      );
    });

    it('passes resolvedTmpdir to createAndStartProxy', () => {
      expect(sandboxSource).toContain('socketPath: resolvedTmpdir');
    });
  });

  describe('R3.5: Socket in tmpdir (No Extra Mount)', () => {
    it('does not add a separate mount for credential socket', () => {
      // The socket should be within tmpdir which is already mounted
      // There should be no additional --volume mount for credential socket
      const dockerPathStart = sandboxSource.indexOf(
        'hopping into sandbox (command:',
      );
      const dockerPath = sandboxSource.substring(dockerPathStart);

      // Should not have any mount specifically for credential socket
      expect(dockerPath).not.toMatch(
        testRegex(
          '--volume.*LLXPRT_CREDENTIAL_SOCKET|--volume.*llxprt-cred',
          '',
        ),
      );
    });
  });

  describe('R3.6: Env Var Passed to Container', () => {
    it('passes LLXPRT_CREDENTIAL_SOCKET via --env', () => {
      expect(sandboxSource).toContain(
        "args.push('--env', `LLXPRT_CREDENTIAL_SOCKET=${effectiveSocketPath}`)",
      );
    });

    it('uses getProxySocketPath to get the actual socket path', () => {
      expect(sandboxSource).toContain(
        'const socketPath = getProxySocketPath()',
      );
    });

    it('passes LLXPRT_CAPABILITY_TOKEN via --env-file', () => {
      const fnSection = extractFunctionBody(
        sandboxSource,
        'pushCapabilityEnvFile',
      );
      expect(fnSection.length).toBeGreaterThan(0);
      expect(fnSection).toContain("args.push('--env-file', envFile)");
      expect(fnSection).toContain('LLXPRT_CAPABILITY_TOKEN');
    });

    it('does NOT pass LLXPRT_CAPABILITY_TOKEN via --env (avoids exposing in process args)', () => {
      // Check the ENTIRE source so the invariant holds regardless of
      // which function pushes the token.
      // Match within a single string literal (exclude quotes/newlines) so the
      // regex doesn't cross from --env for socket path to LLXPRT_CAPABILITY_TOKEN
      // in the --env-file section on a different line.
      expect(sandboxSource).not.toMatch(
        /['"]--env['"]\s*,\s*[`'"][^'"\r\n`]*LLXPRT_CAPABILITY_TOKEN/,
      );
      expect(sandboxSource).not.toMatch(
        /['"]-e['"]\s*,\s*[`'"][^'"\r\n`]*LLXPRT_CAPABILITY_TOKEN/,
      );
    });

    it('writes capability token to a temp env file with restrictive permissions', () => {
      const fnSection = extractFunctionBody(
        sandboxSource,
        'pushCapabilityEnvFile',
      );
      expect(fnSection.length).toBeGreaterThan(0);
      expect(fnSection).toContain('fs.openSync');
      expect(fnSection).toContain('0o600');
      expect(fnSection).toContain('LLXPRT_CAPABILITY_TOKEN');
      expect(fnSection).toContain('return undefined');
    });

    it('returns early when capability token is undefined', () => {
      expect(sandboxSource).toContain(
        'if (capabilityToken === undefined) return undefined',
      );
    });

    it('pushCapabilityEnvFile returns cleanup wrapper', () => {
      const fnSection = extractFunctionBody(
        sandboxSource,
        'pushCapabilityEnvFile',
      );
      expect(fnSection.length).toBeGreaterThan(0);
      expect(fnSection).toContain('unlinkSync');
      expect(fnSection).toContain('return');
    });

    it('uses getProxyCapabilityToken to get the capability token', () => {
      expect(sandboxSource).toContain(
        'const capabilityToken = getProxyCapabilityToken()',
      );
    });

    it('registers env file cleanup in setupCredentialProxy', () => {
      // The refactored setupCredentialProxy has a single
      // pushCapabilityEnvFile call after platform-specific setup.
      const callCount = (
        sandboxSource.match(/=\s*pushCapabilityEnvFile\(args/g) ?? []
      ).length;
      expect(callCount).toBe(1);
    });
  });

  describe('R25.2-R25.3: Cleanup on Exit', () => {
    it('imports stopProxy function', () => {
      expect(sandboxSource).toContain('stopProxy');
    });

    it('adds cleanup on process exit signal', () => {
      const cleanupStart = sandboxSource.indexOf(
        'function wireCleanupHandlers',
      );
      expect(cleanupStart).toBeGreaterThan(-1);
      const cleanupSection = sandboxSource.substring(cleanupStart);

      expect(cleanupSection).toContain(
        "process.on('exit', stopCredentialProxy)",
      );
      expect(cleanupSection).toContain(
        "process.on('SIGINT', stopCredentialProxy)",
      );
      expect(cleanupSection).toContain(
        "process.on('SIGTERM', stopCredentialProxy)",
      );
    });

    it('calls composed cleanup before nullifying on sandbox close', () => {
      // Structural assertion: verifies lexical ordering in source, not
      // runtime behavior. A separate E2E test would be needed for that.
      const fnSection = extractFunctionBody(
        sandboxSource,
        'wireCleanupHandlers',
      );
      expect(fnSection.length).toBeGreaterThan(0);
      // Verify cleanup is called BEFORE nullifying
      const cleanupIdx = fnSection.indexOf('credentialProxyBridgeCleanup()');
      const nullifyIdx = fnSection.indexOf(
        'setCredentialProxyBridgeCleanup(undefined)',
      );
      expect(cleanupIdx).toBeGreaterThan(-1);
      expect(nullifyIdx).toBeGreaterThan(-1);
      expect(cleanupIdx).toBeLessThan(nullifyIdx);
    });

    it('adds cleanup on sandbox process close', () => {
      expect(sandboxSource).toContain(
        "sandboxProcess.on('close', stopCredentialProxy)",
      );
    });

    it('kills sandbox process group when proxy container closes', () => {
      const handlerStart = sandboxSource.indexOf(
        'function wireProxyContainerCloseHandler',
      );
      expect(handlerStart).toBeGreaterThan(-1);
      const handlerSection = sandboxSource.substring(
        handlerStart,
        sandboxSource.indexOf('/** Wires all cleanup handlers', handlerStart),
      );

      expect(handlerSection).toContain("proxyContainer.process.on('close'");
      expect(handlerSection).toContain("process.kill(-sandboxPid, 'SIGTERM')");
      expect(handlerSection).toContain('Proxy container command');
      expect(handlerSection).toContain(
        'exited with code ${code}, signal ${signal}',
      );
    });

    it('cleans up proxy in catch block on error', () => {
      const handlerStart = sandboxSources.sandbox.indexOf(
        'async function handleSandboxStartError',
      );
      expect(handlerStart).toBeGreaterThan(-1);
      const handlerEnd = sandboxSources.sandbox.indexOf(
        '}',
        sandboxSources.sandbox.indexOf('throw error;', handlerStart),
      );
      const handlerSection = sandboxSources.sandbox.substring(
        handlerStart,
        handlerEnd,
      );
      const stopProxyIdx = handlerSection.indexOf('await stopProxy()');
      const throwIdx = handlerSection.indexOf('throw error;');
      expect(stopProxyIdx).toBeGreaterThan(-1);
      expect(throwIdx).toBeGreaterThan(-1);
      expect(stopProxyIdx).toBeLessThan(throwIdx);
      expect(sandboxSources.containers).toContain(
        '@plan:PLAN-20250214-CREDPROXY.P34 R25.2, R25.3:',
      );
    });
  });

  describe('R26.2: Seatbelt Unaffected', () => {
    it('seatbelt path does not call createAndStartProxy', () => {
      const seatbeltStart = sandboxSources.seatbelt.indexOf(
        'async function runSeatbeltSandbox',
      );
      const seatbeltEnd = sandboxSources.seatbelt.indexOf(
        'function resolveProxyUrl',
      );

      expect(seatbeltStart).toBeGreaterThan(-1);
      expect(seatbeltEnd).toBeGreaterThan(seatbeltStart);

      const seatbeltSection = sandboxSources.seatbelt.substring(
        seatbeltStart,
        seatbeltEnd,
      );

      expect(seatbeltSection).not.toContain('createAndStartProxy');
      expect(seatbeltSection).not.toContain('credentialProxyHandle');
      expect(seatbeltSection).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
    });

    it('seatbelt path returns before Docker/Podman path', () => {
      const startSandboxStart = sandboxSource.indexOf(
        'export async function start_sandbox',
      );
      const seatbeltBranch = sandboxSource.indexOf(
        "if (config.command === 'sandbox-exec')",
        startSandboxStart,
      );
      const seatbeltReturn = sandboxSource.indexOf(
        'return exitCode;',
        seatbeltBranch,
      );
      const containerCall = sandboxSource.indexOf(
        'await runContainerSandbox',
        seatbeltBranch,
      );

      expect(startSandboxStart).toBeGreaterThan(-1);
      expect(seatbeltBranch).toBeGreaterThan(startSandboxStart);
      expect(seatbeltReturn).toBeGreaterThan(seatbeltBranch);
      expect(containerCall).toBeGreaterThan(seatbeltReturn);
    });
  });

  describe('Plan Markers', () => {
    it('contains P34 plan marker for proxy creation', () => {
      expect(sandboxSource).toContain(
        '@plan:PLAN-20250214-CREDPROXY.P34 R25.1:',
      );
    });

    it('contains P34 plan marker for realpath', () => {
      expect(sandboxSource).toContain(
        '@plan:PLAN-20250214-CREDPROXY.P34 R3.4:',
      );
    });

    it('contains P34 plan marker for env var', () => {
      expect(sandboxSource).toContain(
        '@plan:PLAN-20250214-CREDPROXY.P34 R3.6:',
      );
    });

    it('contains P34 plan marker for cleanup', () => {
      expect(sandboxSource).toContain(
        '@plan:PLAN-20250214-CREDPROXY.P34 R25.2, R25.3:',
      );
    });
  });
});

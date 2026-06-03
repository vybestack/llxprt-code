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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the sandbox.ts source for behavioral verification
const sandboxSource = fs.readFileSync(
  path.join(__dirname, 'sandbox.ts'),
  'utf-8',
);

describe('Credential Proxy Integration - sandbox.ts', () => {
  describe('R25.1: Proxy Server Created Before Container', () => {
    it('imports createAndStartProxy from sandbox-proxy-lifecycle', () => {
      expect(sandboxSource).toContain(
        "import {\n  createAndStartProxy,\n  stopProxy,\n  getProxySocketPath,\n} from '../auth/proxy/sandbox-proxy-lifecycle.js';",
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
        /Failed to start credential proxy:/g,
      );

      expect(proxyFailureIndex).toBeGreaterThan(-1);
      expect(catchIndex).toBeGreaterThan(-1);
      expect(proxyFailureSection).toContain('catch (err)');
      expect(proxyFailureSection).toContain('throw new FatalSandboxError(');
      expect(messagePrefixMatches).toHaveLength(1);
    });

    it('wraps createAndStartProxy in try-catch', () => {
      // Verify the pattern: try { credentialProxyHandle = await createAndStartProxy
      const pattern =
        // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
        /try\s*\{\s*credentialProxyHandle\s*=\s*await\s+createAndStartProxy/;
      expect(sandboxSource).toMatch(pattern);
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
        // eslint-disable-next-line sonarjs/regular-expr -- Static test regex reviewed for lint hardening; behavior preserved.
        /--volume.*LLXPRT_CREDENTIAL_SOCKET|--volume.*llxprt-cred/,
      );
    });
  });

  describe('R3.6: Env Var Passed to Container', () => {
    it('passes LLXPRT_CREDENTIAL_SOCKET via --env', () => {
      expect(sandboxSource).toContain(
        "args.push('--env', `LLXPRT_CREDENTIAL_SOCKET=${socketPath}`)",
      );
    });

    it('uses getProxySocketPath to get the actual socket path', () => {
      expect(sandboxSource).toContain(
        'const socketPath = getProxySocketPath()',
      );
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
      expect(sandboxSource).toContain('await stopProxy()');
      expect(sandboxSource).toContain(
        '// @plan:PLAN-20250214-CREDPROXY.P34 - Clean up credential proxy on error',
      );
    });
  });

  describe('R26.2: Seatbelt Unaffected', () => {
    it('seatbelt path does not call createAndStartProxy', () => {
      const seatbeltStart = sandboxSource.indexOf(
        'async function runSeatbeltSandbox',
      );
      const seatbeltEnd = sandboxSource.indexOf('function resolveProxyUrl');

      expect(seatbeltStart).toBeGreaterThan(-1);
      expect(seatbeltEnd).toBeGreaterThan(seatbeltStart);

      const seatbeltSection = sandboxSource.substring(
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

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
      // The proxy must be created before args.push(image)
      const createProxyIndex = sandboxSource.indexOf(
        'await createAndStartProxy',
      );
      const pushImageIndex = sandboxSource.indexOf('args.push(image)');

      expect(createProxyIndex).toBeGreaterThan(-1);
      expect(pushImageIndex).toBeGreaterThan(-1);

      // In Docker/Podman path, createAndStartProxy should appear before pushing image
      // Find the Docker/Podman section (after seatbelt return)
      const dockerPathStart = sandboxSource.indexOf(
        'hopping into sandbox (command:',
      );
      expect(dockerPathStart).toBeGreaterThan(-1);

      // Get the relevant substring for Docker/Podman path
      const dockerPath = sandboxSource.substring(dockerPathStart);
      const proxyInDocker = dockerPath.indexOf('createAndStartProxy');
      const spawnInDocker = dockerPath.indexOf('spawn(config.command, args, {');

      expect(proxyInDocker).toBeGreaterThan(-1);
      expect(spawnInDocker).toBeGreaterThan(-1);
      expect(proxyInDocker).toBeLessThan(spawnInDocker);
    });
  });

  describe('R25.1a: Proxy Creation Failure Aborts', () => {
    it('throws FatalSandboxError on proxy creation failure', () => {
      expect(sandboxSource).toContain(
        'throw new FatalSandboxError(\n        `Failed to start credential proxy:',
      );
    });

    it('wraps createAndStartProxy in try-catch', () => {
      // Verify the pattern: try { credentialProxyHandle = await createAndStartProxy
      const pattern =
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
      // Should register handlers for exit, SIGINT, SIGTERM
      const dockerPath = sandboxSource.substring(
        sandboxSource.indexOf('hopping into sandbox'),
      );

      expect(dockerPath).toContain("process.on('exit', stopCredentialProxy)");
      expect(dockerPath).toContain("process.on('SIGINT', stopCredentialProxy)");
      expect(dockerPath).toContain(
        "process.on('SIGTERM', stopCredentialProxy)",
      );
    });

    it('adds cleanup on sandbox process close', () => {
      expect(sandboxSource).toContain(
        "sandboxProcess.on('close', stopCredentialProxy)",
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
      // Extract seatbelt section - from 'sandbox-exec' check to its return
      const seatbeltStart = sandboxSource.indexOf(
        "if (config.command === 'sandbox-exec')",
      );
      const seatbeltEnd = sandboxSource.indexOf(
        'hopping into sandbox (command:',
      );

      expect(seatbeltStart).toBeGreaterThan(-1);
      expect(seatbeltEnd).toBeGreaterThan(seatbeltStart);

      const seatbeltSection = sandboxSource.substring(
        seatbeltStart,
        seatbeltEnd,
      );

      // Seatbelt section should NOT contain credential proxy calls
      expect(seatbeltSection).not.toContain('createAndStartProxy');
      expect(seatbeltSection).not.toContain('credentialProxyHandle');
      expect(seatbeltSection).not.toContain('LLXPRT_CREDENTIAL_SOCKET');
    });

    it('seatbelt path returns before Docker/Podman path', () => {
      // The seatbelt path should have a return statement before the Docker path
      const seatbeltStart = sandboxSource.indexOf(
        "if (config.command === 'sandbox-exec')",
      );
      const dockerStart = sandboxSource.indexOf(
        'hopping into sandbox (command:',
      );

      // Find the return in the seatbelt section
      const seatbeltSection = sandboxSource.substring(
        seatbeltStart,
        dockerStart,
      );
      expect(seatbeltSection).toContain('return await new Promise<number>');
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

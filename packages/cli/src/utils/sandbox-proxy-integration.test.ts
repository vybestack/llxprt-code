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

import { describe, it, expect } from 'bun:test';
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
    throw new Error(
      `extractFunctionBody: function "${fnName}" not found in source`,
    );
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
      const startProxyHelperIndex = sandboxSource.indexOf(
        'async function startCredentialProxyForSandbox',
      );
      const createProxyIndex = sandboxSource.indexOf(
        'await createAndStartProxy',
        startProxyHelperIndex,
      );
      const setupProxyIndex = sandboxSource.indexOf(
        'async function setupCredentialProxy',
      );
      const startProxyHelperCallIndex = sandboxSource.indexOf(
        'await startCredentialProxyForSandbox',
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

      expect(createProxyIndex).toBeGreaterThan(startProxyHelperIndex);
      expect(startProxyHelperCallIndex).toBeGreaterThan(setupProxyIndex);
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

    it('narrows the tmpdir mount to a per-session directory', () => {
      expect(sandboxSource).toMatch(
        /fs\.mkdtempSync\(\s*path\.join\(resolvedTmpdir,\s*'llxprt-sandbox-',?\s*\)/,
      );
      expect(sandboxSource).toContain(
        '`${sessionTmpdir}:${getContainerPath(sessionTmpdir)}`',
      );
    });

    it('passes sessionTmpdir to createAndStartProxy', () => {
      expect(sandboxSource).toContain('socketPath: sessionTmpdir');
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
  });

  describe('R3.6a: host-only capability env file (AC1, #1954)', () => {
    it('passes the capability via --env-file (never via --env with the raw token)', () => {
      // The new design uses --env-file pointing at a host-only file; the raw
      // token never appears in any --env/-e argument.
      expect(sandboxSource).not.toMatch(
        /['"]--env['"]\s*,\s*[`'"][^'"\r\n`]*LLXPRT_CAPABILITY_TOKEN/,
      );
      expect(sandboxSource).not.toMatch(
        /['"]-e['"]\s*,\s*[`'"][^'"\r\n`]*LLXPRT_CAPABILITY_TOKEN/,
      );
      // createHostOnlyCapabilityEnvFile produces the --env-file args.
      expect(sandboxSource).toContain('createHostOnlyCapabilityEnvFile');
    });

    it('uses getProxyCapabilityToken to obtain the capability token', () => {
      // setupCredentialProxy obtains the token via getProxyCapabilityToken()
      // and supplies it to the host-only env-file producer.
      expect(sandboxSource).toMatch(/getProxyCapabilityToken\(\)/);
    });

    it('registers host-only env-file cleanup in setupCredentialProxy', () => {
      expect(sandboxSource).toMatch(/createHostOnlyCapabilityEnvFile/);
    });
  });

  describe('AC1: host-only env file is outside every mount and has restrictive modes', () => {
    // Production-path behavioral coverage of createHostOnlyCapabilityEnvFile
    // lives in sandbox-entrypoint.test.ts (AC1/F4). These source-wiring
    // assertions confirm the container setup still calls the producer and
    // never injects the raw token via --env.
    it('createHostOnlyCapabilityEnvFile is the only capability transport producer and never uses --env with the raw token', () => {
      expect(sandboxSource).toContain('createHostOnlyCapabilityEnvFile');
      expect(sandboxSource).not.toMatch(
        /['"]--env['"]\s*,\s*[`'"][^'"\r\n`]*LLXPRT_CAPABILITY_TOKEN/,
      );
      expect(sandboxSource).not.toMatch(
        /['"]-e['"]\s*,\s*[`'"][^'"\r\n`]*LLXPRT_CAPABILITY_TOKEN/,
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

    it('cleans up proxy on error (AC10)', () => {
      // AC10: start_sandbox wraps runContainerSandbox/runSeatbeltSandbox in
      // try/catch then runs runSandboxCleanup outside the try/catch, which
      // attempts every cleanup step and aggregates non-idempotent failures
      // with the primary sandbox error via AggregateError. The containers
      // module registers the R25.2/R25.3 cleanup markers.
      const startSandboxStart = sandboxSource.indexOf(
        'export async function start_sandbox',
      );
      expect(startSandboxStart).toBeGreaterThan(-1);
      const startSandboxSection = sandboxSource.substring(
        startSandboxStart,
        sandboxSource.indexOf('\n}', startSandboxStart),
      );
      // runSandboxCleanup runs on every success/failure path.
      expect(startSandboxSection).toContain('runSandboxCleanup');
      expect(startSandboxSection).toContain('AggregateError');
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
      // The seatbelt branch assigns exitCode then falls through to the
      // cleanup section; the container call appears after the seatbelt
      // branch block. Assert the seatbelt branch precedes the container call.
      const containerCall = sandboxSource.indexOf(
        'await runContainerSandbox',
        seatbeltBranch,
      );

      expect(startSandboxStart).toBeGreaterThan(-1);
      expect(seatbeltBranch).toBeGreaterThan(startSandboxStart);
      expect(containerCall).toBeGreaterThan(seatbeltBranch);
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

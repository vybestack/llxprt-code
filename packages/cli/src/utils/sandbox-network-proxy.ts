/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolution of the sandbox network proxy endpoint (#3501).
 *
 * The network proxy (`LLXPRT_SANDBOX_PROXY_COMMAND`, unrelated to the
 * credential proxy) is configured through the standard proxy environment
 * variables. Every consumer of that endpoint — the host readiness probe, the
 * published sidecar port, and the proxy variables handed to the sandboxed
 * child — must agree on one URL and one port, so they all read it from here
 * instead of repeating a hard-coded default.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';

const execAsync = promisify(exec);

/** Endpoint used when no proxy environment variable configures one. */
export const DEFAULT_SANDBOX_PROXY_URL = 'http://localhost:8877';

const PROXY_URL_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
] as const;

/**
 * Carries the endpoint into the readiness shell through the environment
 * rather than the command string, so a configured URL is never interpolated
 * into nested shell quoting.
 */
const PROXY_READY_URL_ENV = 'LLXPRT_SANDBOX_PROXY_READY_URL';

export function resolveSandboxProxyUrl(env: NodeJS.ProcessEnv): string {
  const configured = PROXY_URL_ENV_KEYS.map((key) => env[key]).find(
    (value): value is string => value !== undefined && value !== '',
  );
  return configured ?? DEFAULT_SANDBOX_PROXY_URL;
}

function schemeDefaultPort(protocol: string): number | undefined {
  if (protocol === 'http:') return 80;
  if (protocol === 'https:') return 443;
  return undefined;
}

/**
 * The port the sandbox proxy is reachable on. The host publishes it for the
 * sidecar container and probes it for readiness, so an endpoint whose port
 * cannot be determined is a fatal misconfiguration rather than a value to
 * guess at.
 */
export function resolveSandboxProxyPort(proxyUrl: string): number {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new FatalSandboxError(
      `Sandbox proxy endpoint '${proxyUrl}' is not a valid URL. Set ` +
        `HTTPS_PROXY or HTTP_PROXY to an absolute URL such as ` +
        `${DEFAULT_SANDBOX_PROXY_URL}.`,
    );
  }
  if (parsed.port !== '') return Number(parsed.port);
  const schemePort = schemeDefaultPort(parsed.protocol);
  if (schemePort === undefined) {
    throw new FatalSandboxError(
      `Sandbox proxy endpoint '${proxyUrl}' has no port and its scheme ` +
        `'${parsed.protocol}' has no default port. Set HTTPS_PROXY or ` +
        `HTTP_PROXY to an absolute URL such as ${DEFAULT_SANDBOX_PROXY_URL}.`,
    );
  }
  return schemePort;
}

/**
 * Polls the configured proxy endpoint until it answers or the timeout
 * elapses. Rejects with the underlying process failure; callers classify it
 * together with whatever they must release.
 */
export async function awaitSandboxProxyReady(
  proxyUrl: string,
  timeoutMs: number,
): Promise<void> {
  await execAsync(
    `timeout ${Math.floor(timeoutMs / 1000)} bash -c ` +
      `'until curl -s "$${PROXY_READY_URL_ENV}"; do sleep 0.25; done'`,
    {
      timeout: timeoutMs + 5000,
      env: { ...process.env, [PROXY_READY_URL_ENV]: proxyUrl },
    },
  );
}

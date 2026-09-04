/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { FatalSandboxError } from '@vybestack/llxprt-code-core';
import {
  DEFAULT_SANDBOX_PROXY_URL,
  resolveSandboxProxyPort,
  resolveSandboxProxyUrl,
} from './sandbox-network-proxy.js';

describe('resolveSandboxProxyUrl', () => {
  it('falls back to the documented default when nothing configures a proxy', () => {
    expect(resolveSandboxProxyUrl({})).toBe('http://localhost:8877');
  });

  it.each([
    ['HTTPS_PROXY', 'http://localhost:1111'],
    ['https_proxy', 'http://localhost:2222'],
    ['HTTP_PROXY', 'http://localhost:3333'],
    ['http_proxy', 'http://localhost:4444'],
  ])('reads the proxy endpoint from %s', (key, url) => {
    expect(resolveSandboxProxyUrl({ [key]: url })).toBe(url);
  });

  it('prefers HTTPS_PROXY over every later candidate', () => {
    expect(
      resolveSandboxProxyUrl({
        HTTPS_PROXY: 'http://localhost:1111',
        https_proxy: 'http://localhost:2222',
        HTTP_PROXY: 'http://localhost:3333',
        http_proxy: 'http://localhost:4444',
      }),
    ).toBe('http://localhost:1111');
  });

  it('skips an empty candidate and reads the next one', () => {
    expect(
      resolveSandboxProxyUrl({
        HTTPS_PROXY: '',
        https_proxy: '',
        HTTP_PROXY: 'http://localhost:3333',
      }),
    ).toBe('http://localhost:3333');
  });
});

describe('resolveSandboxProxyPort', () => {
  it('resolves the default endpoint to the documented sandbox proxy port', () => {
    expect(resolveSandboxProxyPort(DEFAULT_SANDBOX_PROXY_URL)).toBe(8877);
  });

  it('reads the explicit port of a configured endpoint', () => {
    expect(resolveSandboxProxyPort('http://127.0.0.1:49213')).toBe(49213);
  });

  it.each([
    ['http://localhost', 80],
    ['https://localhost', 443],
  ])('derives the scheme default port for %s', (url, port) => {
    expect(resolveSandboxProxyPort(url)).toBe(port);
  });

  it('rejects an endpoint that is not a URL', () => {
    expect(() => resolveSandboxProxyPort('localhost:8877')).toThrow(
      FatalSandboxError,
    );
  });

  it('names the offending value so the misconfiguration is actionable', () => {
    expect(() => resolveSandboxProxyPort('not a url')).toThrowError(
      /not a url/,
    );
  });

  it('rejects a scheme that carries no default port', () => {
    expect(() => resolveSandboxProxyPort('socks5://localhost')).toThrow(
      FatalSandboxError,
    );
  });
});

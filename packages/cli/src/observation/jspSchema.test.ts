/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseBootstrap, type JspBootstrapInput } from './jspSchema.js';

const validBootstrap = {
  schema: 1,
  protocol: 'jsp/1',
  endpoint: 'http://127.0.0.1:9123/jsp/1',
  registration_id: 'reg-abc',
  publisher_credential: 'pub-secret-xyz',
  agent_id: 'agent-alex',
  lifecycle_generation: 7,
} satisfies JspBootstrapInput;

function errorCode(
  result: ReturnType<typeof parseBootstrap>,
): string | undefined {
  return result.ok ? undefined : result.error.code;
}

function errorMessage(
  result: ReturnType<typeof parseBootstrap>,
): string | undefined {
  return result.ok ? undefined : result.error.message;
}

describe('parseBootstrap', () => {
  it('accepts a closed valid bootstrap', () => {
    const result = parseBootstrap(validBootstrap);
    expect(result.ok).toBe(true);
    expect(errorCode(result)).toBeUndefined();
  });

  it('rejects an unknown top-level field', () => {
    const result = parseBootstrap({ ...validBootstrap, extra: true });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E001');
  });

  it('rejects a non-loopback endpoint', () => {
    for (const endpoint of [
      'http://192.168.1.5:9123/jsp/1',
      'http://example.com/jsp/1',
    ]) {
      const result = parseBootstrap({ ...validBootstrap, endpoint });
      expect(result.ok).toBe(false);
      expect(errorCode(result)).toBe('JSP-E004');
    }
  });

  it('rejects an endpoint carrying a query string', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://127.0.0.1:9123?token=abc',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E001');
  });

  // A bare delimiter reports an empty search/hash but still travels in the
  // endpoint string, so appending the route segment would yield a target such
  // as "http://127.0.0.1:9123?/jsp/1" with the route folded into the query.
  it('rejects an endpoint carrying a bare query or fragment delimiter', () => {
    for (const endpoint of [
      'http://127.0.0.1:9123?',
      'http://127.0.0.1:9123#',
      'http://127.0.0.1:9123?#',
      'http://127.0.0.1:9123/jsp/1?',
      'http://127.0.0.1:9123/jsp/1#',
    ]) {
      const result = parseBootstrap({ ...validBootstrap, endpoint });
      expect(result.ok).toBe(false);
      expect(errorCode(result)).toBe('JSP-E001');
      expect(errorMessage(result)).toBe(
        'endpoint must not include a query or fragment',
      );
    }
  });

  it('rejects an endpoint carrying a fragment', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://127.0.0.1:9123#frag',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E001');
  });

  it('reports a distinct, accurate message for each endpoint rejection branch', () => {
    const unparseable = parseBootstrap({
      ...validBootstrap,
      endpoint: 'not a url',
    });
    expect(errorMessage(unparseable)).toBe('endpoint is not a valid URL');

    const badScheme = parseBootstrap({
      ...validBootstrap,
      endpoint: 'ws://127.0.0.1:9123/jsp/1',
    });
    expect(errorMessage(badScheme)).toBe(
      'endpoint scheme must be http or https',
    );

    const nonLoopback = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://192.168.1.5:9123/jsp/1',
    });
    expect(errorMessage(nonLoopback)).toBe(
      'endpoint host must be a loopback address',
    );

    const query = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://127.0.0.1:9123?token=abc',
    });
    expect(errorMessage(query)).toBe(
      'endpoint must not include a query or fragment',
    );
  });

  it('never echoes rejected endpoint input in its diagnostic', () => {
    const endpoint = 'ws://user:s3cr3t-do-not-leak@127.0.0.1:9123/jsp/1';
    const result = parseBootstrap({ ...validBootstrap, endpoint });
    expect(result.ok).toBe(false);
    const message = errorMessage(result);
    expect(message).not.toContain('s3cr3t-do-not-leak');
    expect(message).not.toContain('127.0.0.1');
    expect(message).not.toContain('ws');
    expect(message).not.toContain(endpoint);
  });

  it('rejects a wrong protocol version', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      protocol: 'jsp/2',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E003');
  });

  it('rejects a zero lifecycle generation with JSP-E004', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      lifecycle_generation: 0,
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E004');
  });

  it('rejects a negative lifecycle generation with JSP-E001', () => {
    for (const lifecycle_generation of [-1, -2, -999]) {
      const result = parseBootstrap({
        ...validBootstrap,
        lifecycle_generation,
      });
      expect(result.ok).toBe(false);
      expect(errorCode(result)).toBe('JSP-E001');
    }
  });

  it('rejects a non-integer lifecycle generation with JSP-E001', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      lifecycle_generation: 1.5,
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E001');
  });

  it('accepts a positive lifecycle generation', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      lifecycle_generation: 1,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts a large positive lifecycle generation', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      lifecycle_generation: Number.MAX_SAFE_INTEGER,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts https on loopback', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'https://127.0.0.1:9443/jsp/1',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts localhost as loopback', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://localhost:9123/jsp/1',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-http(s) scheme as a shape violation', () => {
    for (const endpoint of [
      'ws://127.0.0.1:9123/jsp/1',
      'ftp://127.0.0.1:9123/jsp/1',
      'file:///jsp/1',
      'urn:example:test',
      'javascript://127.0.0.1:9123/jsp/1',
    ]) {
      const result = parseBootstrap({ ...validBootstrap, endpoint });
      expect(result.ok).toBe(false);
      expect(errorCode(result)).toBe('JSP-E001');
      expect(errorMessage(result)).toBe(
        'endpoint scheme must be http or https',
      );
    }
  });

  // A scheme-prefixed endpoint that is itself unparsable must reach the
  // malformed-URL branch, not the scheme branch, even though both report
  // JSP-E001. Pinned by message so the two branches cannot be confused.
  // Two independent causes of a parse failure are covered so this does not
  // rest on a single WHATWG rule: a file URL may not carry a port, and the
  // IPv6 literal is unterminated. Both throw in Node and in Bun.
  it('rejects a scheme-prefixed but unparsable endpoint as a malformed URL', () => {
    for (const endpoint of [
      'file://127.0.0.1:9123/jsp/1',
      'http://[::1:9123/jsp/1',
    ]) {
      const result = parseBootstrap({ ...validBootstrap, endpoint });
      expect(result.ok).toBe(false);
      expect(errorCode(result)).toBe('JSP-E001');
      expect(errorMessage(result)).toBe('endpoint is not a valid URL');
    }
  });

  // URL parsing rejects an out-of-range IPv4 literal before the loopback test
  // runs, so this is reported as a malformed endpoint rather than a non-
  // loopback one. Pinned so the rejection cannot silently become acceptance.
  it('rejects a 127.x host whose octets are out of range', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://127.999.999.999:9123/jsp/1',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E001');
  });

  it('accepts a non-obvious but valid loopback host', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://127.255.255.254:9123/jsp/1',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts zero-padded loopback octets', () => {
    for (const host of [
      '127.0.0.01',
      '127.0.00.1',
      '127.00.0.1',
      '127.000.000.000',
      '127.010.020.001',
    ]) {
      const result = parseBootstrap({
        ...validBootstrap,
        endpoint: `http://${host}:9123/jsp/1`,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects a non-loopback host with zero-padded-looking octets', () => {
    for (const host of [
      '128.0.0.01',
      '126.000.000.000',
      '10.0.0.01',
      '192.168.001.001',
    ]) {
      const result = parseBootstrap({
        ...validBootstrap,
        endpoint: `http://${host}:9123/jsp/1`,
      });
      expect(result.ok).toBe(false);
      expect(errorCode(result)).toBe('JSP-E004');
    }
  });

  it('rejects a missing required credential', () => {
    const { publisher_credential: _omitted, ...rest } = validBootstrap;
    const result = parseBootstrap(rest);
    expect(result.ok).toBe(false);
  });

  it('accepts every loopback form the observer may hand back', () => {
    for (const host of [
      '127.0.0.1',
      '127.255.255.254',
      'localhost',
      'app.localhost',
      '[::1]',
      '[0:0:0:0:0:0:0:1]',
    ]) {
      const result = parseBootstrap({
        ...validBootstrap,
        endpoint: `http://${host}:9123/jsp/1`,
      });
      expect(result.ok).toBe(true);
    }
  });

  it('rejects a registration_id whose UTF-8 bytes exceed 128', () => {
    // Each 'é' is 2 UTF-8 bytes. 64 of them = 128 bytes (at the limit, valid).
    const atLimit = 'é'.repeat(64);
    expect(
      parseBootstrap({ ...validBootstrap, registration_id: atLimit }).ok,
    ).toBe(true);
    // 65 of them = 130 bytes (one byte over the limit, invalid).
    const overLimit = 'é'.repeat(65);
    expect(
      parseBootstrap({ ...validBootstrap, registration_id: overLimit }).ok,
    ).toBe(false);
  });

  it('rejects a registration_id whose UTF-8 bytes exceed 128 with a 4-byte char', () => {
    // 31 'é' (2 bytes each = 62 bytes) + one '𝕏' (4 bytes) = 66 bytes, well
    // under 128. This is just a sanity check that 4-byte chars are counted.
    const valid = 'é'.repeat(31) + '𝕏';
    expect(Buffer.byteLength(valid, 'utf8')).toBeLessThanOrEqual(128);
    expect(
      parseBootstrap({ ...validBootstrap, registration_id: valid }).ok,
    ).toBe(true);
    // 32 '𝕏' = 128 bytes (at the limit, valid).
    const atLimit4 = '𝕏'.repeat(32);
    expect(Buffer.byteLength(atLimit4, 'utf8')).toBe(128);
    expect(
      parseBootstrap({ ...validBootstrap, registration_id: atLimit4 }).ok,
    ).toBe(true);
    // 33 '𝕏' = 132 bytes (over the limit, invalid).
    const overLimit4 = '𝕏'.repeat(33);
    expect(
      parseBootstrap({ ...validBootstrap, registration_id: overLimit4 }).ok,
    ).toBe(false);
  });
});

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
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'http://192.168.1.5:9123/jsp/1',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E004');
  });

  it('rejects a wrong protocol version', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      protocol: 'jsp/2',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E003');
  });

  it('rejects a non-positive lifecycle generation', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      lifecycle_generation: 0,
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E004');
  });

  it('rejects a negative lifecycle generation', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      lifecycle_generation: -1,
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E004');
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

  it('rejects a non-http(s) scheme', () => {
    const result = parseBootstrap({
      ...validBootstrap,
      endpoint: 'ws://127.0.0.1:9123/jsp/1',
    });
    expect(result.ok).toBe(false);
    expect(errorCode(result)).toBe('JSP-E004');
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

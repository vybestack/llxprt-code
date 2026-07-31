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
});

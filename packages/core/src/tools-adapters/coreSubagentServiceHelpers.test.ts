/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildToolGovernance,
  isToolBlocked,
  type ToolGovernance,
} from './coreSubagentServiceHelpers.js';

function createMockConfig(options: {
  ephemerals?: Record<string, unknown>;
  excludeTools?: string[];
}) {
  const ephemerals = options.ephemerals ?? {};
  return {
    getEphemeralSettings: () => ephemerals,
    getExcludeTools: () => options.excludeTools ?? [],
  };
}

describe('coreSubagentServiceHelpers buildToolGovernance', () => {
  describe('allowedExplicit semantics (Issue #2069)', () => {
    it('treats absent tools.allowed as unrestricted (allowedExplicit=false)', () => {
      const governance = buildToolGovernance(createMockConfig({}));

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.allowedExplicit).toBe(false);
    });

    it('treats non-array tools.allowed as unrestricted (allowedExplicit=false)', () => {
      const governance = buildToolGovernance(
        createMockConfig({ ephemerals: { 'tools.allowed': 'nope' } }),
      );

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.allowedExplicit).toBe(false);
    });

    it('treats explicit empty tools.allowed as fail-closed (allowedExplicit=true)', () => {
      const governance = buildToolGovernance(
        createMockConfig({ ephemerals: { 'tools.allowed': [] } }),
      );

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.allowedExplicit).toBe(true);
    });

    it('treats explicit non-empty tools.allowed as explicit allowlist', () => {
      const governance = buildToolGovernance(
        createMockConfig({
          ephemerals: { 'tools.allowed': ['read_file'] },
        }),
      );

      expect(governance.allowed).toStrictEqual(new Set(['read_file']));
      expect(governance.allowedExplicit).toBe(true);
    });
  });

  describe('disabled and excluded extraction', () => {
    it('extracts tools.disabled', () => {
      const governance = buildToolGovernance(
        createMockConfig({
          ephemerals: { 'tools.disabled': ['shell'] },
        }),
      );

      expect(governance.disabled).toStrictEqual(new Set(['shell']));
    });

    it('extracts excluded tools from getExcludeTools()', () => {
      const governance = buildToolGovernance(
        createMockConfig({ excludeTools: ['dangerous_tool'] }),
      );

      expect(governance.excluded).toStrictEqual(new Set(['dangerous_tool']));
    });
  });
});

describe('coreSubagentServiceHelpers isToolBlocked', () => {
  it('allows all normal tools when no explicit allowlist (unrestricted)', () => {
    const governance: ToolGovernance = {
      allowed: new Set(),
      allowedExplicit: false,
      disabled: new Set(),
      excluded: new Set(),
    };

    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(false);
  });

  it('blocks all normal tools when explicit empty allowlist (fail-closed)', () => {
    const governance: ToolGovernance = {
      allowed: new Set(),
      allowedExplicit: true,
      disabled: new Set(),
      excluded: new Set(),
    };

    expect(isToolBlocked('read_file', governance)).toBe(true);
    expect(isToolBlocked('write_file', governance)).toBe(true);
    expect(isToolBlocked('shell', governance)).toBe(true);
  });

  it('blocks tools not in explicit non-empty allowlist', () => {
    const governance: ToolGovernance = {
      allowed: new Set(['read_file']),
      allowedExplicit: true,
      disabled: new Set(),
      excluded: new Set(),
    };

    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });

  it('blocks excluded and disabled tools regardless of allowlist', () => {
    const governance: ToolGovernance = {
      allowed: new Set(['shell']),
      allowedExplicit: true,
      disabled: new Set(['shell']),
      excluded: new Set(),
    };

    expect(isToolBlocked('shell', governance)).toBe(true);
  });
});

describe('coreSubagentServiceHelpers buildToolGovernance + isToolBlocked integration', () => {
  it('blocks all tools when config ephemerals have tools.allowed=[]', () => {
    const governance = buildToolGovernance(
      createMockConfig({ ephemerals: { 'tools.allowed': [] } }),
    );

    expect(governance.allowedExplicit).toBe(true);
    expect(isToolBlocked('read_file', governance)).toBe(true);
    expect(isToolBlocked('shell', governance)).toBe(true);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });

  it('remains unrestricted when tools.allowed is absent', () => {
    const governance = buildToolGovernance(createMockConfig({}));

    expect(governance.allowedExplicit).toBe(false);
    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('shell', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(false);
  });
});

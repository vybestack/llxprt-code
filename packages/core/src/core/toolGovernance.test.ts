/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildToolGovernance,
  isToolBlocked,
  canonicalizeToolName,
  type ToolGovernanceConfig,
  type ToolGovernance,
} from './toolGovernance.js';

function createMockConfig(options: {
  ephemerals?: Record<string, unknown>;
  excludeTools?: string[];
}): ToolGovernanceConfig {
  const ephemerals = options.ephemerals ?? {};
  return {
    getEphemeralSettings: () => ephemerals,
    getExcludeTools: () => options.excludeTools ?? [],
  };
}

describe('buildToolGovernance', () => {
  describe('allowed tools extraction', () => {
    it('should extract tools.allowed from ephemeral settings', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': ['read_file', 'glob'] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toEqual(new Set(['read_file', 'glob']));
    });

    it('should return empty allowed set when tools.allowed is not present', () => {
      const config = createMockConfig({ ephemerals: {} });

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toEqual(new Set());
    });

    it('should return empty allowed set when tools.allowed is not an array', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': 'not-an-array' },
      });

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toEqual(new Set());
    });
  });

  describe('disabled tools extraction', () => {
    it('should extract tools.disabled from ephemeral settings', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.disabled': ['shell', 'write_file'] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toEqual(new Set(['shell', 'write_file']));
    });

    it('should fallback to disabled-tools if tools.disabled is not present', () => {
      const config = createMockConfig({
        ephemerals: { 'disabled-tools': ['shell', 'write_file'] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toEqual(new Set(['shell', 'write_file']));
    });

    it('should prefer tools.disabled over disabled-tools when both present', () => {
      const config = createMockConfig({
        ephemerals: {
          'tools.disabled': ['shell'],
          'disabled-tools': ['write_file'],
        },
      });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toEqual(new Set(['shell']));
      expect(governance.disabled.has('write_file')).toBe(false);
    });

    it('should return empty disabled set when neither key is present', () => {
      const config = createMockConfig({ ephemerals: {} });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toEqual(new Set());
    });
  });

  describe('excluded tools extraction', () => {
    it('should include excluded tools from getExcludeTools()', () => {
      const config = createMockConfig({
        excludeTools: ['dangerous_tool'],
      });

      const governance = buildToolGovernance(config);

      expect(governance.excluded).toEqual(new Set(['dangerous_tool']));
    });

    it('should return empty excluded set when getExcludeTools returns empty array', () => {
      const config = createMockConfig({ excludeTools: [] });

      const governance = buildToolGovernance(config);

      expect(governance.excluded).toEqual(new Set());
    });

    it('should handle undefined getExcludeTools gracefully', () => {
      const config: ToolGovernanceConfig = {
        getEphemeralSettings: () => ({}),
        getExcludeTools: undefined,
      };

      const governance = buildToolGovernance(config);

      expect(governance.excluded).toEqual(new Set());
    });
  });

  describe('config edge cases', () => {
    it('should handle undefined getEphemeralSettings gracefully', () => {
      const config: ToolGovernanceConfig = {
        getEphemeralSettings: undefined,
        getExcludeTools: () => [],
      };

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toEqual(new Set());
      expect(governance.disabled).toEqual(new Set());
      expect(governance.excluded).toEqual(new Set());
    });

    it('should handle getEphemeralSettings returning null/undefined', () => {
      const config: ToolGovernanceConfig = {
        getEphemeralSettings: () => undefined,
        getExcludeTools: () => [],
      };

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toEqual(new Set());
      expect(governance.disabled).toEqual(new Set());
    });
  });
});

describe('canonicalizeToolName', () => {
  describe('basic normalization', () => {
    it('should trim whitespace from tool names', () => {
      expect(canonicalizeToolName('  read_file  ')).toBe('read_file');
    });

    it('should convert to lowercase', () => {
      expect(canonicalizeToolName('READ_FILE')).toBe('read_file');
    });

    it('should handle already normalized names', () => {
      expect(canonicalizeToolName('read_file')).toBe('read_file');
    });
  });

  describe('camelCase to snake_case conversion', () => {
    it('should normalize WriteFileTool to write_file', () => {
      expect(canonicalizeToolName('WriteFileTool')).toBe('write_file');
    });

    it('should normalize writeFile to write_file', () => {
      expect(canonicalizeToolName('writeFile')).toBe('write_file');
    });

    it('should normalize ReadFile to read_file', () => {
      expect(canonicalizeToolName('ReadFile')).toBe('read_file');
    });
  });

  describe('uppercase handling', () => {
    it('should normalize WRITE_FILE to write_file', () => {
      expect(canonicalizeToolName('WRITE_FILE')).toBe('write_file');
    });

    it('should normalize SHELL to shell', () => {
      expect(canonicalizeToolName('SHELL')).toBe('shell');
    });
  });

  describe('consistency', () => {
    it('should produce same output for equivalent inputs', () => {
      const variants = [
        'WriteFileTool',
        'writeFile',
        'write_file',
        'WRITE_FILE',
        '  write_file  ',
      ];

      const normalized = variants.map(canonicalizeToolName);
      const uniqueResults = new Set(normalized);

      expect(uniqueResults.size).toBe(1);
      expect(normalized[0]).toBe('write_file');
    });
  });
});

describe('isToolBlocked', () => {
  describe('excluded tools', () => {
    it('should block excluded tools', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        disabled: new Set<string>(),
        excluded: new Set(['shell']),
      };

      expect(isToolBlocked('shell', governance)).toBe(true);
    });

    it('should block excluded tools even if in allowed set', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['shell']),
        disabled: new Set<string>(),
        excluded: new Set(['shell']),
      };

      expect(isToolBlocked('shell', governance)).toBe(true);
    });
  });

  describe('disabled tools', () => {
    it('should block disabled tools', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('write_file', governance)).toBe(true);
    });

    it('should block disabled tools even if in allowed set', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['write_file']),
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('write_file', governance)).toBe(true);
    });
  });

  describe('allowed tools whitelist', () => {
    it('should block tools not in allowed set when allowed is non-empty', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['read_file', 'glob']),
        disabled: new Set<string>(),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('write_file', governance)).toBe(true);
      expect(isToolBlocked('read_file', governance)).toBe(false);
    });

    it('should allow all tools when allowed set is empty', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        disabled: new Set<string>(),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('any_tool', governance)).toBe(false);
      expect(isToolBlocked('write_file', governance)).toBe(false);
      expect(isToolBlocked('shell', governance)).toBe(false);
    });
  });

  describe('priority order: excluded > disabled > allowed whitelist', () => {
    it('should prioritize excluded over disabled', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        disabled: new Set(['shell']),
        excluded: new Set(['shell']),
      };

      expect(isToolBlocked('shell', governance)).toBe(true);
    });

    it('should prioritize disabled over allowed whitelist', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['shell', 'read_file']),
        disabled: new Set(['shell']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('shell', governance)).toBe(true);
      expect(isToolBlocked('read_file', governance)).toBe(false);
    });
  });

  describe('tool name normalization in blocking decisions', () => {
    it('should normalize tool names when checking blocked status', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('WRITE_FILE', governance)).toBe(true);
      expect(isToolBlocked('  write_file  ', governance)).toBe(true);
    });

    it('should handle camelCase tool names in blocking decisions', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('writeFile', governance)).toBe(true);
      expect(isToolBlocked('WriteFileTool', governance)).toBe(true);
    });
  });
});

describe('buildToolGovernance + isToolBlocked integration', () => {
  it('should normalize tool names in governance sets for consistent blocking', () => {
    const config = createMockConfig({
      ephemerals: { 'tools.disabled': ['WriteFileTool'] },
    });

    const governance = buildToolGovernance(config);

    expect(isToolBlocked('write_file', governance)).toBe(true);
    expect(isToolBlocked('WriteFileTool', governance)).toBe(true);
    expect(isToolBlocked('writeFile', governance)).toBe(true);
  });

  it('should normalize allowed tools for consistent whitelist checking', () => {
    const config = createMockConfig({
      ephemerals: { 'tools.allowed': ['ReadFile', 'Glob'] },
    });

    const governance = buildToolGovernance(config);

    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('glob', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });

  it('should normalize excluded tools for consistent blocking', () => {
    const config = createMockConfig({
      excludeTools: ['DangerousTool'],
    });

    const governance = buildToolGovernance(config);

    expect(isToolBlocked('dangerous_tool', governance)).toBe(true);
    expect(isToolBlocked('DangerousTool', governance)).toBe(true);
    expect(isToolBlocked('dangerousTool', governance)).toBe(true);
  });
});

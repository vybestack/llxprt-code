/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildToolGovernance,
  isToolBlocked,
  canonicalizeApiQualifiedToolName,
  canonicalizeToolName,
  getToolNameCandidates,
  type ToolGovernanceConfig,
  type ToolGovernance,
} from './toolGovernance.js';
import { INVALID_TOOL_NAME } from '@vybestack/llxprt-code-tools';

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

      expect(governance.allowed).toStrictEqual(new Set(['read_file', 'glob']));
    });

    it('should return empty allowed set when tools.allowed is not present', () => {
      const config = createMockConfig({ ephemerals: {} });

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.allowedExplicit).toBe(false);
    });

    it('should return empty allowed set when tools.allowed is not an array', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': 'not-an-array' },
      });

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toStrictEqual(new Set());
      // Non-array values are not treated as an explicit allowlist; default
      // (unrestricted) behavior applies.
      expect(governance.allowedExplicit).toBe(false);
    });

    // Issue #2069: explicit empty tools.allowed must be distinguished from
    // absent tools.allowed.
    it('should set allowedExplicit=true for explicit empty tools.allowed', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': [] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.allowedExplicit).toBe(true);
    });

    it('should set allowedExplicit=true for non-empty tools.allowed', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': ['read_file'] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.allowedExplicit).toBe(true);
    });
  });

  describe('disabled tools extraction', () => {
    it('should extract tools.disabled from ephemeral settings', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.disabled': ['shell', 'write_file'] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toStrictEqual(
        new Set(['shell', 'write_file']),
      );
    });

    it('should fallback to disabled-tools if tools.disabled is not present', () => {
      const config = createMockConfig({
        ephemerals: { 'disabled-tools': ['shell', 'write_file'] },
      });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toStrictEqual(
        new Set(['shell', 'write_file']),
      );
    });

    it('should prefer tools.disabled over disabled-tools when both present', () => {
      const config = createMockConfig({
        ephemerals: {
          'tools.disabled': ['shell'],
          'disabled-tools': ['write_file'],
        },
      });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toStrictEqual(new Set(['shell']));
      expect(governance.disabled.has('write_file')).toBe(false);
    });

    it('should return empty disabled set when neither key is present', () => {
      const config = createMockConfig({ ephemerals: {} });

      const governance = buildToolGovernance(config);

      expect(governance.disabled).toStrictEqual(new Set());
    });
  });

  describe('excluded tools extraction', () => {
    it('should include excluded tools from getExcludeTools()', () => {
      const config = createMockConfig({
        excludeTools: ['dangerous_tool'],
      });

      const governance = buildToolGovernance(config);

      expect(governance.excluded).toStrictEqual(new Set(['dangerous_tool']));
    });

    it('should return empty excluded set when getExcludeTools returns empty array', () => {
      const config = createMockConfig({ excludeTools: [] });

      const governance = buildToolGovernance(config);

      expect(governance.excluded).toStrictEqual(new Set());
    });

    it('should handle undefined getExcludeTools gracefully', () => {
      const config: ToolGovernanceConfig = {
        getEphemeralSettings: () => ({}),
        getExcludeTools: undefined,
      };

      const governance = buildToolGovernance(config);

      expect(governance.excluded).toStrictEqual(new Set());
    });
  });

  describe('config edge cases', () => {
    it('should handle undefined getEphemeralSettings gracefully', () => {
      const config: ToolGovernanceConfig = {
        getEphemeralSettings: undefined,
        getExcludeTools: () => [],
      };

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.disabled).toStrictEqual(new Set());
      expect(governance.excluded).toStrictEqual(new Set());
    });

    it('should handle getEphemeralSettings returning null/undefined', () => {
      const config: ToolGovernanceConfig = {
        getEphemeralSettings: () => undefined,
        getExcludeTools: () => [],
      };

      const governance = buildToolGovernance(config);

      expect(governance.allowed).toStrictEqual(new Set());
      expect(governance.disabled).toStrictEqual(new Set());
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

  describe('dotted name handling', () => {
    it('should keep arbitrary dotted names in global canonicalization', () => {
      expect(canonicalizeToolName('tool.v1')).toBe('tool.v1');
      expect(canonicalizeToolName('run.cmd')).toBe('run.cmd');
    });

    it('should keep API namespace prefixes in global canonicalization', () => {
      expect(canonicalizeToolName('functions.run_shell_command')).toBe(
        'functions.run_shell_command',
      );
      expect(canonicalizeToolName('github.list_files')).toBe(
        'github.list_files',
      );
    });

    it('should apply Tool-suffix stripping to the final dotted segment', () => {
      expect(canonicalizeToolName('functions.RunShellCommandTool')).toBe(
        'functions.run_shell_command',
      );
      expect(canonicalizeToolName('myns.Tool')).toBe('myns.tool');
    });

    it('should return INVALID_TOOL_NAME for blank and empty dotted segments', () => {
      expect(canonicalizeToolName('')).toBe(INVALID_TOOL_NAME);
      expect(canonicalizeToolName('   ')).toBe(INVALID_TOOL_NAME);
      expect(canonicalizeToolName('functions.')).toBe(INVALID_TOOL_NAME);
      expect(canonicalizeToolName('.run_shell_command')).toBe(
        INVALID_TOOL_NAME,
      );
      expect(canonicalizeToolName('functions..run_shell_command')).toBe(
        INVALID_TOOL_NAME,
      );
    });
  });

  // Issue #2184: API-qualified tool names (e.g. functions.run_shell_command)
  // must resolve to registry tool names only where whitelist inputs are accepted.
  describe('API-qualified whitelist canonicalization (Issue #2184)', () => {
    it('should strip functions. prefix from qualified name', () => {
      expect(
        canonicalizeApiQualifiedToolName('functions.run_shell_command'),
      ).toBe('run_shell_command');
    });

    it('should strip arbitrary namespace prefix from qualified name', () => {
      expect(canonicalizeApiQualifiedToolName('github.list_files')).toBe(
        'list_files',
      );
    });

    it('should strip multi-segment namespace prefixes from qualified names', () => {
      expect(canonicalizeApiQualifiedToolName('a.b.run_shell_command')).toBe(
        'run_shell_command',
      );
      expect(canonicalizeApiQualifiedToolName('github.repo.read_file')).toBe(
        'read_file',
      );
    });

    it('should strip namespace prefix then strip Tool suffix', () => {
      expect(
        canonicalizeApiQualifiedToolName('functions.RunShellCommandTool'),
      ).toBe('run_shell_command');
    });

    it('should treat single-dot whitelist names as namespace-qualified names', () => {
      expect(canonicalizeApiQualifiedToolName('tool.v1')).toBe('v1');
      expect(canonicalizeApiQualifiedToolName('run.cmd')).toBe('cmd');
    });

    it('should return INVALID_TOOL_NAME for blank and empty namespace segments', () => {
      expect(canonicalizeApiQualifiedToolName('')).toBe(INVALID_TOOL_NAME);
      expect(canonicalizeApiQualifiedToolName('   ')).toBe(INVALID_TOOL_NAME);
      expect(canonicalizeApiQualifiedToolName('functions.')).toBe(
        INVALID_TOOL_NAME,
      );
      expect(canonicalizeApiQualifiedToolName('.run_shell_command')).toBe(
        INVALID_TOOL_NAME,
      );
      expect(
        canonicalizeApiQualifiedToolName('functions..run_shell_command'),
      ).toBe(INVALID_TOOL_NAME);
    });

    it('should keep existing non-dotted behavior unchanged', () => {
      expect(canonicalizeApiQualifiedToolName('read_file')).toBe('read_file');
      expect(canonicalizeApiQualifiedToolName('WriteFileTool')).toBe(
        'write_file',
      );
      expect(canonicalizeApiQualifiedToolName('READ_FILE')).toBe('read_file');
    });
  });
});

describe('isToolBlocked', () => {
  describe('excluded tools', () => {
    it('should block excluded tools', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        allowedExplicit: false,
        disabled: new Set<string>(),
        excluded: new Set(['shell']),
      };

      expect(isToolBlocked('shell', governance)).toBe(true);
    });

    it('should block excluded tools even if in allowed set', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['shell']),
        allowedExplicit: true,
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
        allowedExplicit: false,
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('write_file', governance)).toBe(true);
    });

    it('should block disabled tools even if in allowed set', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['write_file']),
        allowedExplicit: true,
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
        allowedExplicit: true,
        disabled: new Set<string>(),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('write_file', governance)).toBe(true);
      expect(isToolBlocked('read_file', governance)).toBe(false);
    });

    it('should allow all tools when allowed set is absent (unrestricted)', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        allowedExplicit: false,
        disabled: new Set<string>(),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('any_tool', governance)).toBe(false);
      expect(isToolBlocked('write_file', governance)).toBe(false);
      expect(isToolBlocked('shell', governance)).toBe(false);
    });
  });

  // Issue #2069: explicit empty allowlist must block all normal tools
  describe('explicit empty allowlist (fail-closed)', () => {
    it('should block all normal tools when allowed is explicit empty', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        allowedExplicit: true,
        disabled: new Set<string>(),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('any_tool', governance)).toBe(true);
      expect(isToolBlocked('write_file', governance)).toBe(true);
      expect(isToolBlocked('shell', governance)).toBe(true);
      expect(isToolBlocked('read_file', governance)).toBe(true);
    });

    it('should block all tools from buildToolGovernance with tools.allowed=[]', () => {
      const config = createMockConfig({
        ephemerals: { 'tools.allowed': [] },
      });
      const governance = buildToolGovernance(config);

      expect(governance.allowedExplicit).toBe(true);
      expect(isToolBlocked('read_file', governance)).toBe(true);
      expect(isToolBlocked('shell', governance)).toBe(true);
      expect(isToolBlocked('write_file', governance)).toBe(true);
    });

    it('should remain unrestricted when tools.allowed is absent', () => {
      const config = createMockConfig({ ephemerals: {} });
      const governance = buildToolGovernance(config);

      expect(governance.allowedExplicit).toBe(false);
      expect(isToolBlocked('read_file', governance)).toBe(false);
      expect(isToolBlocked('shell', governance)).toBe(false);
      expect(isToolBlocked('write_file', governance)).toBe(false);
    });
  });

  describe('priority order: excluded > disabled > allowed whitelist', () => {
    it('should prioritize excluded over disabled', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        allowedExplicit: false,
        disabled: new Set(['shell']),
        excluded: new Set(['shell']),
      };

      expect(isToolBlocked('shell', governance)).toBe(true);
    });

    it('should prioritize disabled over allowed whitelist', () => {
      const governance: ToolGovernance = {
        allowed: new Set(['shell', 'read_file']),
        allowedExplicit: true,
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
        allowedExplicit: false,
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('WRITE_FILE', governance)).toBe(true);
      expect(isToolBlocked('  write_file  ', governance)).toBe(true);
    });

    it('should handle camelCase tool names in blocking decisions', () => {
      const governance: ToolGovernance = {
        allowed: new Set<string>(),
        allowedExplicit: false,
        disabled: new Set(['write_file']),
        excluded: new Set<string>(),
      };

      expect(isToolBlocked('writeFile', governance)).toBe(true);
      expect(isToolBlocked('WriteFileTool', governance)).toBe(true);
    });
  });
  describe('tool name candidate generation', () => {
    it('returns only the canonical form for plain and unknown-prefix dotted names', () => {
      expect(getToolNameCandidates('read_file')).toStrictEqual(['read_file']);
      expect(getToolNameCandidates('other.v1')).toStrictEqual(['other.v1']);
    });

    it('returns an empty array for invalid and malformed tool names', () => {
      expect(getToolNameCandidates('')).toStrictEqual([]);
      expect(getToolNameCandidates('   ')).toStrictEqual([]);
      expect(getToolNameCandidates('functions.')).toStrictEqual([]);
      expect(getToolNameCandidates('.run_shell_command')).toStrictEqual([]);
      expect(
        getToolNameCandidates('functions..run_shell_command'),
      ).toStrictEqual([]);
    });

    it('adds a short alias for two-segment known API prefixes', () => {
      expect(
        getToolNameCandidates('functions.run_shell_command'),
      ).toStrictEqual(['functions.run_shell_command', 'run_shell_command']);
    });

    it('does not treat GitHub namespaces as API aliases', () => {
      expect(getToolNameCandidates('github.read_file')).toStrictEqual([
        'github.read_file',
      ]);
      expect(getToolNameCandidates('github.repo.read_file')).toStrictEqual([
        'github.repo.read_file',
      ]);
    });

    it('adds a final-segment alias for versioned api-prefixed strict candidates', () => {
      expect(getToolNameCandidates('api.v1.run_shell_command')).toStrictEqual([
        'api.v1.run_shell_command',
        'v1.run_shell_command',
        'run_shell_command',
      ]);
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

  it('checks API-qualified aliases during blocking checks', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set(['run_shell_command']),
      excluded: new Set<string>(),
    };

    expect(isToolBlocked('run_shell_command', governance)).toBe(true);
    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(true);
  });

  it('checks API-qualified aliases for dotted registry tools', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set(['tool.v1']),
      excluded: new Set<string>(),
    };

    expect(isToolBlocked('tool.v1', governance)).toBe(true);
    expect(isToolBlocked('functions.tool.v1', governance)).toBe(true);
    expect(isToolBlocked('other.v1', governance)).toBe(false);
    expect(isToolBlocked('functions.other.v1', governance)).toBe(false);
  });

  it('does not over-match GitHub namespace names to unqualified tools', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set(['read_file', 'repo', 'repo.read_file', 'v1']),
      excluded: new Set<string>(),
    };

    expect(isToolBlocked('github.read_file', governance)).toBe(false);
    expect(isToolBlocked('github.repo', governance)).toBe(false);
    expect(isToolBlocked('github.repo.read_file', governance)).toBe(false);
    expect(isToolBlocked('github.tool.v1', governance)).toBe(false);

    const exactGovernance: ToolGovernance = {
      ...governance,
      disabled: new Set([...governance.disabled, 'github.repo.read_file']),
    };

    expect(isToolBlocked('github.repo.read_file', exactGovernance)).toBe(true);
  });

  it('checks API-qualified aliases against explicit allowed tools', () => {
    const governance: ToolGovernance = {
      allowed: new Set(['run_shell_command']),
      allowedExplicit: true,
      disabled: new Set<string>(),
      excluded: new Set<string>(),
    };

    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(
      false,
    );
    expect(isToolBlocked('functions.write_file', governance)).toBe(true);
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

  it('normalizes API-qualified governance inputs from config', () => {
    const config = createMockConfig({
      ephemerals: {
        'tools.allowed': ['functions.run_shell_command'],
        'tools.disabled': ['functions.write_file'],
      },
      excludeTools: ['functions.task'],
    });

    const governance = buildToolGovernance(config);

    expect(governance.allowed).toContain('run_shell_command');
    expect(governance.disabled).toContain('write_file');
    expect(governance.excluded).toContain('task');
    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(
      false,
    );
    expect(isToolBlocked('functions.write_file', governance)).toBe(true);
    expect(isToolBlocked('functions.task', governance)).toBe(true);
  });

  it('normalizes versioned api governance inputs from config', () => {
    const config = createMockConfig({
      ephemerals: {
        'tools.allowed': ['api.v1.run_shell_command'],
      },
    });

    const governance = buildToolGovernance(config);

    expect(governance.allowed).toContain('run_shell_command');
    expect(isToolBlocked('run_shell_command', governance)).toBe(false);
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

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

  it('checks API-qualified aliases when applying blocked sets', () => {
    const governance: ToolGovernance = {
      allowed: new Set(['run_shell_command']),
      allowedExplicit: true,
      disabled: new Set(['write_file']),
      excluded: new Set(['task']),
    };

    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(
      false,
    );
    expect(isToolBlocked('functions.write_file', governance)).toBe(true);
    expect(isToolBlocked('functions.task', governance)).toBe(true);
    expect(isToolBlocked('run_shell_command', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });

  it('checks API-qualified aliases for dotted registry tools', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set(['tool.v1']),
      excluded: new Set(),
    };

    expect(isToolBlocked('tool.v1', governance)).toBe(true);
    expect(isToolBlocked('functions.tool.v1', governance)).toBe(true);
  });

  it('does not block unrelated tools that share a suffix with a disabled dotted tool', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set(['tool.v1']),
      excluded: new Set(),
    };

    expect(isToolBlocked('other.v1', governance)).toBe(false);
  });

  it('does not over-match GitHub namespace names to unqualified tools', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set(['read_file', 'repo', 'repo.read_file', 'v1']),
      excluded: new Set(),
    };

    expect(isToolBlocked('github.read_file', governance)).toBe(false);
    expect(isToolBlocked('github.repo', governance)).toBe(false);
    expect(isToolBlocked('github.repo.read_file', governance)).toBe(false);
    expect(isToolBlocked('github.tool.v1', governance)).toBe(false);
    expect(isToolBlocked('read_file', governance)).toBe(true);
    expect(isToolBlocked('repo', governance)).toBe(true);
    expect(isToolBlocked('repo.read_file', governance)).toBe(true);
    expect(isToolBlocked('v1', governance)).toBe(true);

    const exactGovernance: ToolGovernance = {
      ...governance,
      disabled: new Set([...governance.disabled, 'github.repo.read_file']),
    };
    expect(isToolBlocked('github.repo.read_file', exactGovernance)).toBe(true);
  });
});

describe('coreSubagentServiceHelpers tool name candidate generation', () => {
  it('returns an empty array for blank or invalid input', () => {
    expect(getToolNameCandidates('')).toStrictEqual([]);
    expect(getToolNameCandidates('   ')).toStrictEqual([]);
    expect(getToolNameCandidates('functions.')).toStrictEqual([]);
  });

  it('returns only the canonical form for plain and unknown-prefix dotted names', () => {
    expect(getToolNameCandidates('read_file')).toStrictEqual(['read_file']);
    expect(getToolNameCandidates('other.v1')).toStrictEqual(['other.v1']);
  });

  it('adds a short alias for two-segment known API prefixes', () => {
    expect(getToolNameCandidates('functions.run_shell_command')).toStrictEqual([
      'functions.run_shell_command',
      'run_shell_command',
    ]);
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

  it('allows API-qualified aliases for dotted registry tools from config', () => {
    const governance = buildToolGovernance(
      createMockConfig({ ephemerals: { 'tools.allowed': ['tool.v1'] } }),
    );

    expect(governance.allowedExplicit).toBe(true);
    expect(isToolBlocked('functions.tool.v1', governance)).toBe(false);
    expect(isToolBlocked('functions.tool.v2', governance)).toBe(true);
  });

  it('resolves short-form dotted tools when config uses API-qualified entries', () => {
    const governance = buildToolGovernance(
      createMockConfig({
        ephemerals: { 'tools.allowed': ['functions.tool.v1'] },
      }),
    );

    expect(governance.allowedExplicit).toBe(true);
    expect(isToolBlocked('tool.v1', governance)).toBe(false);
    expect(isToolBlocked('tool.v2', governance)).toBe(true);
  });

  it('resolves short-form names when config uses API-qualified entries for non-dotted tools', () => {
    const governance = buildToolGovernance(
      createMockConfig({
        ephemerals: { 'tools.allowed': ['functions.run_shell_command'] },
      }),
    );

    expect(governance.allowedExplicit).toBe(true);
    expect(isToolBlocked('run_shell_command', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });

  it('resolves short-form names when config uses versioned api entries', () => {
    const governance = buildToolGovernance(
      createMockConfig({
        ephemerals: { 'tools.allowed': ['api.v1.run_shell_command'] },
      }),
    );

    expect(governance.allowedExplicit).toBe(true);
    expect(isToolBlocked('run_shell_command', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(true);
  });
});

describe('coreSubagentServiceHelpers canonicalizeToolName', () => {
  it('keeps arbitrary dotted names in global canonicalization', () => {
    expect(canonicalizeToolName('tool.v1')).toBe('tool.v1');
    expect(canonicalizeToolName('run.cmd')).toBe('run.cmd');
  });

  it('keeps API namespace prefixes in global canonicalization', () => {
    expect(canonicalizeToolName('functions.run_shell_command')).toBe(
      'functions.run_shell_command',
    );
    expect(canonicalizeToolName('github.list_files')).toBe('github.list_files');
  });

  it('strips Tool suffix from final dotted segments in global canonicalization', () => {
    expect(canonicalizeToolName('functions.RunShellCommandTool')).toBe(
      'functions.run_shell_command',
    );
    expect(canonicalizeToolName('github.ListFilesTool')).toBe(
      'github.list_files',
    );
    expect(canonicalizeToolName('myns.Tool')).toBe('myns.tool');
  });

  it('returns empty string for blank and empty dotted segments', () => {
    expect(canonicalizeToolName('')).toBe('');
    expect(canonicalizeToolName('   ')).toBe('');
    expect(canonicalizeToolName('functions.')).toBe('');
    expect(canonicalizeToolName('.run_shell_command')).toBe('');
    expect(canonicalizeToolName('functions..run_shell_command')).toBe('');
  });

  it('keeps existing non-dotted behavior unchanged', () => {
    expect(canonicalizeToolName('read_file')).toBe('read_file');
    expect(canonicalizeToolName('WriteFileTool')).toBe('write_file');
    expect(canonicalizeToolName('READ_FILE')).toBe('read_file');
  });
});

// Issue #2184: API-qualified names are only stripped for whitelist inputs while
// preserving the core wrapper's empty-string invalid-name contract.
describe('coreSubagentServiceHelpers canonicalizeApiQualifiedToolName', () => {
  it('strips functions. namespace prefix', () => {
    expect(
      canonicalizeApiQualifiedToolName('functions.run_shell_command'),
    ).toBe('run_shell_command');
  });

  it('strips arbitrary namespace prefix', () => {
    expect(canonicalizeApiQualifiedToolName('github.list_files')).toBe(
      'list_files',
    );
  });

  it('strips multi-segment namespace prefixes', () => {
    expect(canonicalizeApiQualifiedToolName('a.b.run_shell_command')).toBe(
      'run_shell_command',
    );
    expect(canonicalizeApiQualifiedToolName('github.repo.read_file')).toBe(
      'read_file',
    );
  });

  it('strips namespace prefix then strips Tool suffix', () => {
    expect(
      canonicalizeApiQualifiedToolName('functions.RunShellCommandTool'),
    ).toBe('run_shell_command');
  });

  it('treats single-dot whitelist names as namespace-qualified names', () => {
    expect(canonicalizeApiQualifiedToolName('tool.v1')).toBe('v1');
    expect(canonicalizeApiQualifiedToolName('run.cmd')).toBe('cmd');
  });

  it('returns empty string for blank and empty namespace segments', () => {
    expect(canonicalizeApiQualifiedToolName('')).toBe('');
    expect(canonicalizeApiQualifiedToolName('   ')).toBe('');
    expect(canonicalizeApiQualifiedToolName('functions.')).toBe('');
    expect(canonicalizeApiQualifiedToolName('.run_shell_command')).toBe('');
    expect(
      canonicalizeApiQualifiedToolName('functions..run_shell_command'),
    ).toBe('');
  });

  it('keeps existing non-dotted behavior unchanged', () => {
    expect(canonicalizeApiQualifiedToolName('read_file')).toBe('read_file');
    expect(canonicalizeApiQualifiedToolName('WriteFileTool')).toBe(
      'write_file',
    );
    expect(canonicalizeApiQualifiedToolName('READ_FILE')).toBe('read_file');
  });
});

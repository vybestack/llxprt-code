/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildSubagentExcludedToolNames,
  buildToolGovernance,
  getToolNameCandidates,
  isSubagentExcludedToolName,
  isToolBlocked,
  SUBAGENT_EXCLUDED_TOOL_NAMES,
  type ToolGovernance,
  type ToolGovernanceConfig,
} from './toolGovernanceUtils.js';

function createConfig(options: {
  ephemerals?: Record<string, unknown>;
  excludeTools?: unknown;
}): ToolGovernanceConfig {
  return {
    getEphemeralSettings: () => options.ephemerals ?? {},
    getExcludeTools: () => (options.excludeTools ?? []) as string[],
  };
}

function createUnrestrictedGovernance(disabled: string[]): ToolGovernance {
  return {
    allowed: new Set<string>(),
    allowedExplicit: false,
    disabled: new Set(disabled),
    excluded: new Set<string>(),
  };
}

describe('tool governance candidate generation', () => {
  it('keeps plain and non-API dotted names canonical', () => {
    expect(getToolNameCandidates('read_file')).toStrictEqual(['read_file']);
    expect(getToolNameCandidates('tool.v1')).toStrictEqual(['tool.v1']);
    expect(getToolNameCandidates('github.read_file')).toStrictEqual([
      'github.read_file',
    ]);
    expect(getToolNameCandidates('github.repo.read_file')).toStrictEqual([
      'github.repo.read_file',
    ]);
  });

  it('adds API namespace aliases for function and versioned api names', () => {
    expect(getToolNameCandidates('functions.run_shell_command')).toStrictEqual([
      'functions.run_shell_command',
      'run_shell_command',
    ]);
    expect(getToolNameCandidates('api.v1.run_shell_command')).toStrictEqual([
      'api.v1.run_shell_command',
      'v1.run_shell_command',
      'run_shell_command',
    ]);
    expect(getToolNameCandidates('api.read_file')).toStrictEqual([
      'api.read_file',
      'read_file',
    ]);
    expect(getToolNameCandidates('function.read_file')).toStrictEqual([
      'function.read_file',
      'read_file',
    ]);
    expect(getToolNameCandidates('functions.tool.v1')).toStrictEqual([
      'functions.tool.v1',
      'tool.v1',
      'v1',
    ]);
  });

  it('returns no candidates for malformed names', () => {
    expect(getToolNameCandidates('')).toStrictEqual([]);
    expect(getToolNameCandidates('   ')).toStrictEqual([]);
    expect(getToolNameCandidates('functions.')).toStrictEqual([]);
    expect(getToolNameCandidates('.run_shell_command')).toStrictEqual([]);
    expect(getToolNameCandidates('functions..run_shell_command')).toStrictEqual(
      [],
    );
  });
});

describe('subagent excluded tool helpers', () => {
  it('returns a fresh set of canonical subagent excluded tool names', () => {
    const excluded = buildSubagentExcludedToolNames();

    expect(excluded).not.toBe(SUBAGENT_EXCLUDED_TOOL_NAMES);
    expect(excluded).toStrictEqual(new Set(['task', 'list_subagents']));
  });

  it('matches API aliases but keeps GitHub namespace names exact', () => {
    const excluded = buildSubagentExcludedToolNames();

    expect(isSubagentExcludedToolName('task', excluded)).toBe(true);
    expect(isSubagentExcludedToolName('functions.task', excluded)).toBe(true);
    expect(
      isSubagentExcludedToolName('functions.list_subagents', excluded),
    ).toBe(true);
    expect(isSubagentExcludedToolName('github.task', excluded)).toBe(false);
    expect(isSubagentExcludedToolName('github.list_subagents', excluded)).toBe(
      false,
    );
  });

  it('treats malformed names as excluded to fail closed', () => {
    expect(isSubagentExcludedToolName('')).toBe(true);
    expect(isSubagentExcludedToolName('functions.')).toBe(true);
    expect(isSubagentExcludedToolName('functions..task')).toBe(true);
  });
});

describe('tool governance blocking', () => {
  it('matches API-qualified aliases against excluded tools', () => {
    const governance: ToolGovernance = {
      allowed: new Set<string>(),
      allowedExplicit: false,
      disabled: new Set<string>(),
      excluded: new Set(['run_shell_command']),
    };

    expect(isToolBlocked('run_shell_command', governance)).toBe(true);
    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(true);
    expect(isToolBlocked('api.v1.run_shell_command', governance)).toBe(true);
  });

  it('matches API-qualified aliases against disabled tools', () => {
    const governance = createUnrestrictedGovernance(['run_shell_command']);

    expect(isToolBlocked('run_shell_command', governance)).toBe(true);
    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(true);
    expect(isToolBlocked('api.v1.run_shell_command', governance)).toBe(true);
  });

  it('does not over-match GitHub namespaces to unqualified registry names', () => {
    const governance = createUnrestrictedGovernance(['read_file', 'repo']);

    expect(isToolBlocked('github.read_file', governance)).toBe(false);
    expect(isToolBlocked('github.repo', governance)).toBe(false);
    expect(isToolBlocked('github.repo.read_file', governance)).toBe(false);

    const exactGovernance = createUnrestrictedGovernance([
      'read_file',
      'repo',
      'github.repo.read_file',
    ]);

    expect(isToolBlocked('github.repo.read_file', exactGovernance)).toBe(true);
  });

  it('preserves explicit empty allowlists as fail-closed', () => {
    const governance = buildToolGovernance(
      createConfig({ ephemerals: { 'tools.allowed': [] } }),
    );

    expect(governance.allowedExplicit).toBe(true);
    expect(isToolBlocked('read_file', governance)).toBe(true);
    expect(isToolBlocked('', governance)).toBe(true);
  });

  it('treats non-array ephemeral values as unset', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: {
          'tools.allowed': 'read_file',
          'tools.disabled': 'write_file',
          'disabled-tools': 'glob',
        },
      }),
    );

    expect(governance.allowedExplicit).toBe(false);
    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('write_file', governance)).toBe(false);
    expect(isToolBlocked('glob', governance)).toBe(false);
  });

  it('rejects array values containing non-string elements', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: { 'tools.allowed': ['read_file', 42] },
      }),
    );

    expect(governance.allowedExplicit).toBe(false);
    expect(isToolBlocked('read_file', governance)).toBe(false);
  });

  it('treats malformed excluded tool values as unset', () => {
    const nonArrayGovernance = buildToolGovernance(
      createConfig({ excludeTools: 'run_shell_command' }),
    );
    const mixedArrayGovernance = buildToolGovernance(
      createConfig({ excludeTools: ['run_shell_command', 42] }),
    );

    expect(isToolBlocked('run_shell_command', nonArrayGovernance)).toBe(false);
    expect(isToolBlocked('run_shell_command', mixedArrayGovernance)).toBe(
      false,
    );
  });

  it('supports legacy disabled-tools ephemeral key', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: { 'disabled-tools': ['run_shell_command'] },
      }),
    );

    expect(isToolBlocked('run_shell_command', governance)).toBe(true);
  });

  it('prefers tools.disabled over the legacy disabled-tools key', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: {
          'tools.disabled': ['write_file'],
          'disabled-tools': ['run_shell_command'],
        },
      }),
    );

    expect(isToolBlocked('write_file', governance)).toBe(true);
    expect(isToolBlocked('run_shell_command', governance)).toBe(false);
  });

  it('expands API-qualified config entries symmetrically', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: {
          'tools.allowed': ['api.v1.run_shell_command'],
          'tools.disabled': ['functions.write_file'],
        },
        excludeTools: ['functions.task'],
      }),
    );

    expect(isToolBlocked('api.v1.run_shell_command', governance)).toBe(false);
    expect(isToolBlocked('v1.run_shell_command', governance)).toBe(false);
    expect(isToolBlocked('run_shell_command', governance)).toBe(false);
    expect(isToolBlocked('functions.run_shell_command', governance)).toBe(
      false,
    );
    expect(isToolBlocked('functions.write_file', governance)).toBe(true);
    expect(isToolBlocked('write_file', governance)).toBe(true);
    expect(isToolBlocked('functions.task', governance)).toBe(true);
    expect(isToolBlocked('read_file', governance)).toBe(true);
  });

  it('disabled takes precedence over allowed', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: {
          'tools.allowed': ['read_file'],
          'tools.disabled': ['read_file'],
        },
      }),
    );

    expect(isToolBlocked('read_file', governance)).toBe(true);
  });

  it('API-qualified variants match unqualified allowed names', () => {
    const governance = buildToolGovernance(
      createConfig({
        ephemerals: {
          'tools.allowed': ['read_file'],
        },
      }),
    );

    expect(isToolBlocked('read_file', governance)).toBe(false);
    expect(isToolBlocked('api.v1.read_file', governance)).toBe(false);
  });

  it('generates last-segment alias for function-prefixed 3-segment names', () => {
    expect(getToolNameCandidates('function.a.read_file')).toContain(
      'read_file',
    );
    expect(getToolNameCandidates('functions.a.read_file')).toContain(
      'read_file',
    );
  });
});

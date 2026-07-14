/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P14
 * @requirement:REQ-002
 *
 * Behavioral tests for the public config adapter `toConfigParameters`. The
 * adapter translates a typed AgentConfig into an immutable ConfigParameters
 * object for `new Config(...)`. We assert on the REAL mapped values: every
 * typed field lands on its correct ConfigParameters target, arrays are copied
 * (not aliased), objects are deep-cloned (not aliased), compound fields fan out
 * to multiple targets, precedence rules hold, and the UNSTABLE settings escape
 * hatch throws when it shadows a typed field. No mock theater — pure data in,
 * pure data asserted out.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { AgentConfig } from '@vybestack/llxprt-code-agents';
import {
  toConfigParameters,
  AdapterError,
} from '@vybestack/llxprt-code-agents';

/** Reads a ConfigParameters field by name without leaking a cast into asserts. */
function read(params: Readonly<Record<string, unknown>>, key: string): unknown {
  return params[key];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value as Readonly<Record<string, unknown>>;
}

describe('toConfigParameters adapter @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
  it('maps required identity (provider/model) verbatim @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = asRecord(
      toConfigParameters({ provider: 'openai', model: 'gpt-x' }),
    );
    expect(read(params, 'provider')).toBe('openai');
    expect(read(params, 'model')).toBe('gpt-x');
  });

  it('maps simple 1:1 typed scalar fields onto their params targets @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const shell = { enabled: true };
    const config: AgentConfig = {
      provider: 'openai',
      model: 'm',
      proxy: 'http://proxy:8080',
      maxSessionTurns: 7,
      checkpointing: true,
      outputFormat: 'json',
      shell,
      contextLimit: 4096,
      compressionThreshold: 0.75,
      useWriteTodos: true,
      embeddingModel: 'embed-1',
      debugMode: true,
      continueOnFailedApiCall: true,
      toolDiscoveryCommand: 'discover',
      toolCallCommand: 'call',
      mcpServerCommand: 'serve',
      mcpEnabled: true,
      extensionsEnabled: false,
      interactive: true,
      sandbox: { command: 'docker', image: 'sandbox:latest' },
    };
    const params = asRecord(toConfigParameters(config));

    expect(read(params, 'sandbox')).toStrictEqual({
      command: 'docker',
      image: 'sandbox:latest',
    });
    expect(read(params, 'proxy')).toBe('http://proxy:8080');
    expect(read(params, 'maxSessionTurns')).toBe(7);
    expect(read(params, 'checkpointing')).toBe(true);
    expect(read(params, 'outputFormat')).toBe('json');
    // `shell` is a COPY-kind field → mapped by reference, NOT deep-cloned.
    expect(read(params, 'shellReplacement')).toBe(shell);
    expect(read(params, 'contextLimit')).toBe(4096);
    expect(read(params, 'compressionThreshold')).toBe(0.75);
    expect(read(params, 'useWriteTodos')).toBe(true);
    expect(read(params, 'embeddingModel')).toBe('embed-1');
    expect(read(params, 'debugMode')).toBe(true);
    expect(read(params, 'continueOnFailedApiCall')).toBe(true);
    expect(read(params, 'toolDiscoveryCommand')).toBe('discover');
    expect(read(params, 'toolCallCommand')).toBe('call');
    expect(read(params, 'mcpServerCommand')).toBe('serve');
    expect(read(params, 'mcpEnabled')).toBe(true);
    expect(read(params, 'extensionsEnabled')).toBe(false);
    expect(read(params, 'interactive')).toBe(true);
  });

  it('omits simple fields that are undefined on the input (no fabricated keys) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = asRecord(
      toConfigParameters({ provider: 'openai', model: 'm' }),
    );
    expect('proxy' in params).toBe(false);
    expect('maxSessionTurns' in params).toBe(false);
    expect('shellReplacement' in params).toBe(false);
    expect('mcpEnabled' in params).toBe(false);
  });

  it('clones object-valued simple fields (fileFiltering/telemetry/compression) instead of aliasing @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const fileFiltering = { respectGitIgnore: true };
    const telemetry = { enabled: true };
    const compression = { contextPercentageThreshold: 0.5 };
    const config: AgentConfig = {
      provider: 'openai',
      model: 'm',
      fileFiltering,
      telemetry,
      compression,
    };
    const params = asRecord(toConfigParameters(config));

    expect(read(params, 'fileFiltering')).toStrictEqual(fileFiltering);
    expect(read(params, 'telemetry')).toStrictEqual(telemetry);
    // `compression` maps to the renamed target `chatCompression`
    expect(read(params, 'chatCompression')).toStrictEqual(compression);
    // deep clone: not the same reference as the input
    expect(read(params, 'fileFiltering')).not.toBe(fileFiltering);
    expect(read(params, 'telemetry')).not.toBe(telemetry);
    expect(read(params, 'chatCompression')).not.toBe(compression);
  });

  it('copies array fields into fresh mutable arrays (not aliased) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const skill = { name: 'skill-1', prompt: 'do it' };
    const config = {
      provider: 'openai',
      model: 'm',
      includeDirectories: ['a', 'b'],
      excludeTools: ['x'],
      skills: [skill],
      allowedTools: ['t1'],
      allowedMcpServers: ['s1'],
      blockedMcpServers: [{ name: 'bad', extensionName: 'ext' }],
      disabledHooks: ['h1'],
    } as unknown as AgentConfig;
    const params = asRecord(toConfigParameters(config));

    expect(read(params, 'includeDirectories')).toStrictEqual(['a', 'b']);
    expect(read(params, 'includeDirectories')).not.toBe(
      config.includeDirectories,
    );
    expect(read(params, 'excludeTools')).toStrictEqual(['x']);
    // skills maps content-for-content into a fresh array
    expect(read(params, 'skills')).toStrictEqual([skill]);
    expect(read(params, 'skills')).not.toBe(config.skills);
    expect(read(params, 'allowedTools')).toStrictEqual(['t1']);
    expect(read(params, 'allowedMcpServers')).toStrictEqual(['s1']);
    expect(read(params, 'blockedMcpServers')).toStrictEqual([
      { name: 'bad', extensionName: 'ext' },
    ]);
    expect(read(params, 'disabledHooks')).toStrictEqual(['h1']);
  });

  it('does not fabricate array/object keys for absent fields @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = asRecord(
      toConfigParameters({ provider: 'openai', model: 'm' }),
    );
    // array-mapping guards: absent fields must NOT create keys
    expect('includeDirectories' in params).toBe(false);
    expect('excludeTools' in params).toBe(false);
    expect('skills' in params).toBe(false);
    expect('allowedTools' in params).toBe(false);
    expect('coreTools' in params).toBe(false);
    expect('allowedMcpServers' in params).toBe(false);
    expect('blockedMcpServers' in params).toBe(false);
    expect('disabledHooks' in params).toBe(false);
    // object-mapping guards
    expect('mcpServers' in params).toBe(false);
    expect('hooks' in params).toBe(false);
    expect('projectHooks' in params).toBe(false);
    // compound-mapping guards
    expect('cwd' in params).toBe(false);
    expect('targetDir' in params).toBe(false);
    expect('sessionId' in params).toBe(false);
    expect('approvalMode' in params).toBe(false);
    expect('policyEngineConfig' in params).toBe(false);
    expect('folderTrust' in params).toBe(false);
    expect('trustedFolder' in params).toBe(false);
  });

  it('maps both `tools` and `coreTools` onto the `coreTools` target, with coreTools winning precedence @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    // `tools` maps to coreTools; a later `coreTools` mapping overwrites it.
    const withToolsOnly = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        tools: ['from-tools'],
      }),
    );
    expect(read(withToolsOnly, 'coreTools')).toStrictEqual(['from-tools']);

    const withBoth = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        tools: ['from-tools'],
        coreTools: ['from-coreTools'],
      }),
    );
    // coreTools applied after tools → coreTools wins
    expect(read(withBoth, 'coreTools')).toStrictEqual(['from-coreTools']);
  });

  it('deep-clones object-record fields (mcpServers/hooks/projectHooks) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const mcpServers = { srv: { command: 'run' } };
    const hooks = { PreToolUse: [] };
    const projectHooks = { PostToolUse: [] };
    const config = {
      provider: 'openai',
      model: 'm',
      mcpServers,
      hooks,
      projectHooks,
    } as unknown as AgentConfig;
    const params = asRecord(toConfigParameters(config));

    expect(read(params, 'mcpServers')).toStrictEqual(mcpServers);
    expect(read(params, 'mcpServers')).not.toBe(mcpServers);
    expect(read(params, 'hooks')).toStrictEqual(hooks);
    expect(read(params, 'projectHooks')).toStrictEqual(projectHooks);
  });

  it('fans compound fields out to multiple params targets @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const policy = { rules: [] };
    const config = {
      provider: 'openai',
      model: 'm',
      workingDir: '/work',
      sessionId: 'sess-1',
      folderTrust: true,
      approvalMode: 'default',
      policy,
    } as unknown as AgentConfig;
    const params = asRecord(toConfigParameters(config));

    // workingDir → cwd AND targetDir
    expect(read(params, 'cwd')).toBe('/work');
    expect(read(params, 'targetDir')).toBe('/work');
    expect(read(params, 'sessionId')).toBe('sess-1');
    // folderTrust → folderTrust AND trustedFolder
    expect(read(params, 'folderTrust')).toBe(true);
    expect(read(params, 'trustedFolder')).toBe(true);
    // approvalMode passes through; policy → policyEngineConfig (by reference)
    expect(read(params, 'approvalMode')).toBe('default');
    expect(read(params, 'policyEngineConfig')).toBe(policy);
  });

  it('resolves userMemory with systemPrompt taking precedence over memory @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    // systemPrompt present → wins
    const both = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        systemPrompt: 'SYS',
        memory: 'MEM',
      }),
    );
    expect(read(both, 'userMemory')).toBe('SYS');

    // only memory present → memory used
    const memOnly = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        memory: 'MEM',
      }),
    );
    expect(read(memOnly, 'userMemory')).toBe('MEM');

    // neither → no userMemory key
    const neither = asRecord(
      toConfigParameters({ provider: 'openai', model: 'm' }),
    );
    expect('userMemory' in neither).toBe(false);
  });

  it('maps ide sub-fields to ideMode and experimentalZedIntegration @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        ide: { mode: true, experimentalZed: true },
      }),
    );
    expect(read(params, 'ideMode')).toBe(true);
    expect(read(params, 'experimentalZedIntegration')).toBe(true);

    // when ide is absent, neither target is set
    const noIde = asRecord(
      toConfigParameters({ provider: 'openai', model: 'm' }),
    );
    expect('ideMode' in noIde).toBe(false);
    expect('experimentalZedIntegration' in noIde).toBe(false);

    // when ide is present but its sub-fields are undefined, the per-field
    // guards must SKIP each assignment (no fabricated undefined values).
    const emptyIde = asRecord(
      toConfigParameters({ provider: 'openai', model: 'm', ide: {} }),
    );
    expect('ideMode' in emptyIde).toBe(false);
    expect('experimentalZedIntegration' in emptyIde).toBe(false);
  });

  it('maps toolOutputLimits sub-fields to their truncation params @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        toolOutputLimits: {
          truncateThreshold: 1000,
          truncateLines: 50,
          enableTruncation: true,
        },
      }),
    );
    expect(read(params, 'truncateToolOutputThreshold')).toBe(1000);
    expect(read(params, 'truncateToolOutputLines')).toBe(50);
    expect(read(params, 'enableToolOutputTruncation')).toBe(true);

    // present-but-empty limits → each per-field guard SKIPS its assignment.
    const emptyLimits = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        toolOutputLimits: {},
      }),
    );
    expect('truncateToolOutputThreshold' in emptyLimits).toBe(false);
    expect('truncateToolOutputLines' in emptyLimits).toBe(false);
    expect('enableToolOutputTruncation' in emptyLimits).toBe(false);
  });

  it('merges the UNSTABLE settings escape hatch for non-typed keys @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        settings: { someLongTailKey: 'value', another: 42 },
      }),
    );
    expect(read(params, 'someLongTailKey')).toBe('value');
    expect(read(params, 'another')).toBe(42);
  });

  it('allows settings keys that name a NON-typed classified field (agent-sub-surface), proving only typed fields are guarded @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    // `recording` is present in CONFIG_FIELD_CLASSIFICATION but classified as
    // 'agent-sub-surface' (NOT 'typed'). The typed-field guard set is built by
    // FILTERING classification === 'typed', so this must pass through the
    // escape hatch rather than throwing.
    const params = asRecord(
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        settings: { recording: { enabled: false } },
      }),
    );
    expect(read(params, 'recording')).toStrictEqual({ enabled: false });
  });

  it('throws AdapterError when settings shadows a typed AgentConfig field @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const build = (): unknown =>
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        settings: { provider: 'shadow' },
      });
    expect(build).toThrow(AdapterError);
    // assert the FULL descriptive message (names the key AND explains why),
    // not merely that the key substring appears.
    expect(build).toThrow(
      'field provider must be a typed AgentConfig field, not settings',
    );
    // the thrown error carries the AdapterError brand `name` and identity.
    let caught: unknown;
    try {
      build();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AdapterError);
    expect((caught as Error).name).toBe('AdapterError');
  });

  it('throws AdapterError when settings shadows the typed harness field @plan:PLAN-20260626-RUNTIMEBOUNDARY.P01 @requirement:REQ-002', () => {
    const build = (): unknown =>
      toConfigParameters({
        provider: 'openai',
        model: 'm',
        settings: { harness: { forceConfirmations: false } },
      });
    expect(build).toThrow(AdapterError);
    expect(build).toThrow(
      'field harness must be a typed AgentConfig field, not settings',
    );
  });

  it('returns a frozen params object (immutable result) @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const params = toConfigParameters({ provider: 'openai', model: 'm' });
    expect(Object.isFrozen(params)).toBe(true);
  });

  // ─── property-based invariants ───────────────────────────────────────────

  it('property: required identity (provider/model) is mapped verbatim for any non-empty strings @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    const nonEmpty = fc.string({ minLength: 1 });
    fc.assert(
      fc.property(nonEmpty, nonEmpty, (provider, model) => {
        const params = asRecord(toConfigParameters({ provider, model }));
        expect(read(params, 'provider')).toBe(provider);
        expect(read(params, 'model')).toBe(model);
      }),
    );
  });

  it('property: the result is ALWAYS frozen regardless of which optional scalar fields are present @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            proxy: fc.string(),
            maxSessionTurns: fc.integer(),
            checkpointing: fc.boolean(),
            outputFormat: fc.constantFrom('text', 'json'),
            contextLimit: fc.integer(),
            debugMode: fc.boolean(),
            interactive: fc.boolean(),
          },
          { requiredKeys: [] },
        ),
        (optional) => {
          const config = {
            provider: 'openai',
            model: 'm',
            ...optional,
          } as unknown as AgentConfig;
          const params = toConfigParameters(config);
          expect(Object.isFrozen(params)).toBe(true);
        },
      ),
    );
  });

  it('property: array fields are copied not aliased — mutating the result never mutates the input and the input is unchanged @plan:PLAN-20260617-COREAPI.P14 @requirement:REQ-002', () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (tools) => {
        const config = {
          provider: 'openai',
          model: 'm',
          coreTools: tools,
        } as unknown as AgentConfig;
        // Snapshot the input array contents BEFORE the adapter runs.
        const inputSnapshot = structuredClone(tools);

        const params = asRecord(toConfigParameters(config));
        const mapped = read(params, 'coreTools');
        expect(Array.isArray(mapped)).toBe(true);
        const mappedArr = mapped as string[];

        // Content equality at the mapping point.
        expect(mappedArr).toStrictEqual(tools);

        // Mutating the mapped array must NOT alias back into the input.
        mappedArr.push('__mutation_probe__');
        expect(tools).toStrictEqual(inputSnapshot);

        // And the original input object's field is unchanged by the call.
        expect(config.coreTools).toStrictEqual(inputSnapshot);
      }),
    );
  });
});

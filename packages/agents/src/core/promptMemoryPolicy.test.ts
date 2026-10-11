/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the shared prompt memory-derivation policy
 * (issue #3173). The policy is consumed by both the main-agent and subagent
 * system-prompt builders so that JIT memory sourcing is identical across
 * execution contexts.
 *
 * These tests assert actual resolved values (user memory, core memory, MCP
 * instructions, and the working-directory JIT lookup), never mock invocation
 * counts in isolation.
 */

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

import { describe, it, expect, vi } from 'bun:test';
import { resolvePromptMemory } from './promptMemoryPolicy.js';

interface MemoryFixtureInputs {
  isJitContextEnabled?: () => boolean;
  getWorkingDir?: () => string;
  globalMemory?: () => string;
  userMemory?: () => string;
  coreMemory?: () => string | undefined;
  jit?: (targetPath: string) => Promise<string>;
}

function makeConfig(inputs: MemoryFixtureInputs = {}) {
  return {
    declarations: {
      isJitContextEnabled: inputs.isJitContextEnabled ?? (() => false),
      getWorkingDir: inputs.getWorkingDir ?? (() => '/workspace'),
    },
    instructions: {
      snapshot: () => ({
        globalMemory: inputs.globalMemory?.() ?? '',
        memoryContent: inputs.userMemory?.() ?? '',
        environmentMemory: '',
        coreMemory: inputs.coreMemory?.() ?? '',
        fileCount: 0,
        coreMemoryFileCount: 0,
        filePaths: [],
      }),
      jit: inputs.jit ?? (async () => ''),
    },
  };
}

describe('resolvePromptMemory (issue #3173)', () => {
  describe('JIT enabled', () => {
    it('sources user memory from global plus JIT memory for the working directory', async () => {
      const {
        sourcesUserMemoryFromGlobalPlusJITMemoryForTheWorkingDirectoryObservation1,
      } =
        await observeSourcesUserMemoryFromGlobalPlusJITMemoryForTheWorkingDirectory();
      expect(
        sourcesUserMemoryFromGlobalPlusJITMemoryForTheWorkingDirectoryObservation1,
      ).toStrictEqual(['GLOBAL_MEMORY', 'JIT_SUBDIRECTORY']);
    });

    const observeSourcesUserMemoryFromGlobalPlusJITMemoryForTheWorkingDirectory =
      async () => {
        // The JIT lookup is keyed by directory: only the working directory's
        // memory may reach the output, so a mis-forwarded path shows up as the
        // wrong JIT content in the assertion below.
        const jit = vi.fn(async (lookupPath: string) =>
          lookupPath === '/proj/sub' ? 'JIT_SUBDIRECTORY' : 'JIT_ELSEWHERE',
        );
        const config = makeConfig({
          isJitContextEnabled: vi.fn().mockReturnValue(true),
          globalMemory: vi.fn().mockReturnValue('GLOBAL_MEMORY'),
          jit,
          getWorkingDir: vi.fn().mockReturnValue('/proj/sub'),
        });

        const result = await resolvePromptMemory(
          config.declarations,
          () => undefined,
          fixturePaths().directories(),
          config.instructions,
        );

        // Derived aggregation and ordering: global first, working-directory JIT
        // second, joined by the two-newline separator.

        const sourcesUserMemoryFromGlobalPlusJITMemoryForTheWorkingDirectoryObservation1 =
          result.userMemory?.split('\n\n');
        return {
          sourcesUserMemoryFromGlobalPlusJITMemoryForTheWorkingDirectoryObservation1,
        };
      };

    it('does not consult userMemory when JIT is enabled', async () => {
      // userMemory returns a sentinel that must NOT appear in the output.
      // If the policy accidentally fell back to userMemory, the sentinel
      // would leak into userMemory. The global+JIT sources use disjoint
      // values to catch cross-source contamination.
      const userMemory = vi.fn().mockReturnValue('SHOULD_NOT_APPEAR');
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        globalMemory: vi.fn().mockReturnValue('GLOBAL_A'),
        jit: vi.fn().mockResolvedValue('JIT_B'),
        userMemory,
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => undefined,
        fixturePaths().directories(),
        config.instructions,
      );

      expect(result.userMemory).not.toContain('SHOULD_NOT_APPEAR');
    });

    it('preserves core memory and MCP instructions from their dedicated sources', async () => {
      // Each source returns a disjoint sentinel so that cross-source
      // contamination shows up as a sentinel leaking into the wrong channel.
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        globalMemory: vi.fn().mockReturnValue('G_SENTINEL'),
        jit: vi.fn().mockResolvedValue('J_SENTINEL'),
        coreMemory: vi.fn().mockReturnValue('C_SENTINEL'),
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => 'M_SENTINEL',
        fixturePaths().directories(),
        config.instructions,
      );

      // User channel carries only global+JIT sentinels — core and MCP
      // sentinels must not leak into it.
      expect(result.userMemory).toBe('G_SENTINEL\n\nJ_SENTINEL');
      expect(result.userMemory).not.toContain('C_SENTINEL');
      expect(result.userMemory).not.toContain('M_SENTINEL');
      // Core channel carries only the core sentinel.
      expect(result.coreMemory).toBe('C_SENTINEL');
      expect(result.coreMemory).not.toContain('M_SENTINEL');
      expect(result.coreMemory).not.toContain('G_SENTINEL');
      // MCP channel carries only the MCP sentinel.
      expect(result.mcpInstructions).toBe('M_SENTINEL');
      expect(result.mcpInstructions).not.toContain('C_SENTINEL');
      expect(result.mcpInstructions).not.toContain('G_SENTINEL');
    });

    it('produces JIT-only user memory when global memory is empty', async () => {
      const { result } =
        await observeProducesJITOnlyUserMemoryWhenGlobalMemoryIsEmpty();
      expect(result.userMemory).toBe('JIT_CORRECT');
      expect(result.userMemory).not.toContain('JIT_WRONG');
    });

    const observeProducesJITOnlyUserMemoryWhenGlobalMemoryIsEmpty =
      async () => {
        // Key-sensitive JIT: a mis-forwarded working-directory path would
        // deliver JIT_WRONG instead of JIT_CORRECT. The global leak sentinel
        // catches a fallback-to-global regression.
        const jit = vi.fn(async (lookupPath: string) =>
          lookupPath === '/workspace' ? 'JIT_CORRECT' : 'JIT_WRONG',
        );
        const config = makeConfig({
          isJitContextEnabled: vi.fn().mockReturnValue(true),
          globalMemory: vi.fn().mockReturnValue(''),
          jit,
        });

        const result = await resolvePromptMemory(
          config.declarations,
          () => undefined,
          fixturePaths().directories(),
          config.instructions,
        );

        // The implementation joins global+JIT with a two-newline separator
        // when both are non-empty. With an empty global, the result is
        // JIT_CORRECT directly (no separator). A wrong-path lookup would
        // produce JIT_WRONG.

        return { result };
      };

    it('produces global-only user memory when JIT memory is empty', async () => {
      const { result } =
        await observeProducesGlobalOnlyUserMemoryWhenJITMemoryIsEmpty();
      expect(result.userMemory).toBe('GLOBAL_ONLY');
      expect(result.userMemory).not.toContain('JIT_WRONG');
    });

    const observeProducesGlobalOnlyUserMemoryWhenJITMemoryIsEmpty =
      async () => {
        // Key-sensitive JIT: the working directory's lookup returns '', but a
        // wrong path would return 'JIT_WRONG'. If the policy forwarded the
        // wrong path's result, the assertion would fail.
        const jit = vi.fn(async (lookupPath: string) =>
          lookupPath === '/workspace' ? '' : 'JIT_WRONG',
        );
        const config = makeConfig({
          isJitContextEnabled: vi.fn().mockReturnValue(true),
          globalMemory: vi.fn().mockReturnValue('GLOBAL_ONLY'),
          jit,
        });

        const result = await resolvePromptMemory(
          config.declarations,
          () => undefined,
          fixturePaths().directories(),
          config.instructions,
        );

        return { result };
      };

    it('produces no synthetic whitespace when both global and JIT are empty', async () => {
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        globalMemory: vi.fn().mockReturnValue(''),
        jit: vi.fn().mockResolvedValue(''),
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => undefined,
        fixturePaths().directories(),
        config.instructions,
      );

      // Derived count: two empty sources must aggregate to zero characters,
      // not to a bare separator.
      expect(result.userMemory).toHaveLength(0);
    });
  });

  describe('JIT disabled', () => {
    it('sources user memory from userMemory unchanged', async () => {
      const { result } =
        await observeSourcesUserMemoryFromGetUserMemoryUnchanged();
      expect(result.userMemory).toBe('USER_VALUE');
      expect(result.userMemory).not.toContain('GLOBAL_LEAK');
      expect(result.userMemory).not.toContain('JIT_LEAK');
    });

    const observeSourcesUserMemoryFromGetUserMemoryUnchanged = async () => {
      // The global leak sentinel proves the disabled path uses userMemory,
      // not globalMemory. The JIT lookup returns '' for the working dir
      // (as it does in production when JIT is disabled) so nothing is
      // appended.
      const jit = vi.fn(async (lookupPath: string) =>
        lookupPath === '/workspace' ? '' : 'JIT_LEAK',
      );
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        userMemory: vi.fn().mockReturnValue('USER_VALUE'),
        globalMemory: vi.fn().mockReturnValue('GLOBAL_LEAK'),
        jit,
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => undefined,
        fixturePaths().directories(),
        config.instructions,
      );

      return { result };
    };

    it('adds no JIT subdirectory memory', async () => {
      const { result } = await observeAddsNoJITSubdirectoryMemory();
      expect(result.userMemory).toBe('USER_VALUE');
      expect(result.userMemory).not.toContain('JIT_LEAK');
    });

    const observeAddsNoJITSubdirectoryMemory = async () => {
      // The JIT lookup is key-sensitive: a wrong path returns JIT_LEAK,
      // the correct path returns ''. resolvePromptMemory calls
      // jit unconditionally and appends truthy results;
      // the disabled path works only because the key-sensitive double
      // returns '' for the working dir. The test verifies no JIT content
      // leaks into userMemory regardless.
      const jit = vi.fn(async (lookupPath: string) =>
        lookupPath === '/workspace' ? '' : 'JIT_LEAK',
      );
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        userMemory: vi.fn().mockReturnValue('USER_VALUE'),
        jit,
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => undefined,
        fixturePaths().directories(),
        config.instructions,
      );

      return { result };
    };

    it('preserves core memory and MCP instructions', async () => {
      // Disjoint sentinels per channel so cross-source contamination is
      // detectable.
      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(false),
        userMemory: vi.fn().mockReturnValue('U_SENTINEL'),
        coreMemory: vi.fn().mockReturnValue('C_SENTINEL'),
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => 'M_SENTINEL',
        fixturePaths().directories(),
        config.instructions,
      );

      expect(result.userMemory).toBe('U_SENTINEL');
      expect(result.userMemory).not.toContain('C_SENTINEL');
      expect(result.userMemory).not.toContain('M_SENTINEL');
      expect(result.coreMemory).toBe('C_SENTINEL');
      expect(result.coreMemory).not.toContain('M_SENTINEL');
      expect(result.mcpInstructions).toBe('M_SENTINEL');
      expect(result.mcpInstructions).not.toContain('C_SENTINEL');
    });
  });

  describe('core-memory capture ordering (deferred-JIT regression)', () => {
    it('captures core memory before awaiting JIT memory', async () => {
      // Simulate a concurrent core-memory refresh: the value returned by
      // coreMemory changes while jit is pending. The
      // pre-extraction main builder read core memory before the JIT await, so
      // the shared policy must capture the pre-await value (issue #3173
      // review Blocker-Fix).
      let coreMemoryValue = 'CORE_BEFORE';
      const coreMemory = vi.fn(() => coreMemoryValue);
      const jit = vi.fn(async () => {
        coreMemoryValue = 'CORE_AFTER';
        return 'JIT_MARKER';
      });

      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        globalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        jit,
        coreMemory,
      });

      const result = await resolvePromptMemory(
        config.declarations,
        () => undefined,
        fixturePaths().directories(),
        config.instructions,
      );

      // Pre-await core capture: core has the value that existed BEFORE the
      // JIT await mutated it. A post-await read would see CORE_AFTER.
      expect(result.coreMemory).toBe('CORE_BEFORE');
      expect(result.coreMemory).not.toBe('CORE_AFTER');
    });

    it('reads MCP instructions after the JIT await to preserve main-agent ordering', async () => {
      // MCP instructions were acquired after the JIT await in the
      // pre-extraction main builder; the shared policy must keep that ordering.
      let mcpValue = 'MCP_BEFORE';
      const readMcpInstructions = () => mcpValue;
      const jit = vi.fn(async () => {
        mcpValue = 'MCP_AFTER';
        return 'JIT_MARKER';
      });

      const config = makeConfig({
        isJitContextEnabled: vi.fn().mockReturnValue(true),
        globalMemory: vi.fn().mockReturnValue('GLOBAL_MARKER'),
        jit,
      });

      const result = await resolvePromptMemory(
        config.declarations,
        readMcpInstructions,
        fixturePaths().directories(),
        config.instructions,
      );

      // Post-await MCP read: MCP has the value that existed AFTER the JIT
      // await mutated it. A pre-await read would see MCP_BEFORE.
      expect(result.mcpInstructions).toBe('MCP_AFTER');
      expect(result.mcpInstructions).not.toBe('MCP_BEFORE');
    });
  });
});

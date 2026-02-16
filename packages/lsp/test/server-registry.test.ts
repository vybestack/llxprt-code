import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  createServerRegistry,
  getBuiltinServers,
  getServersForExtension,
  mergeUserConfig,
  type ServerRegistryEntry,
} from '../src/service/server-registry.js';

/* @plan:PLAN-20250212-LSP.P14 */

describe('server-registry (phase P14 TDD)', () => {
  const customServer = (
    overrides: Partial<ServerRegistryEntry> = {},
  ): ServerRegistryEntry => ({
    id: overrides.id ?? 'custom',
    displayName: overrides.displayName ?? 'Custom',
    extensions: overrides.extensions ?? ['.custom'],
    command: overrides.command ?? 'custom-ls',
    args: overrides.args,
    env: overrides.env,
    workspaceRootMarkers: overrides.workspaceRootMarkers,
    initializationOptions: overrides.initializationOptions,
    detectCommand: overrides.detectCommand,
  });

  describe('built-ins', () => {
    it('includes TypeScript built-in id', () => {
      const ids = getBuiltinServers().map((s) => s.id);
      expect(ids).toContain('ts');
    });

    it('includes ESLint built-in id', () => {
      const ids = getBuiltinServers().map((s) => s.id);
      expect(ids).toContain('eslint');
    });

    it('includes Go built-in id', () => {
      const ids = getBuiltinServers().map((s) => s.id);
      expect(ids).toContain('gopls');
    });

    it('includes Python built-in id', () => {
      const ids = getBuiltinServers().map((s) => s.id);
      expect(ids).toContain('python');
    });

    it('includes Rust built-in id', () => {
      const ids = getBuiltinServers().map((s) => s.id);
      expect(ids).toContain('rust');
    });
  });

  describe('extension lookup', () => {
    it('returns ts and eslint for .ts', () => {
      const servers = getServersForExtension('.ts', getBuiltinServers());
      const ids = servers.map((s) => s.id);
      expect(ids).toEqual(expect.arrayContaining(['ts', 'eslint']));
    });

    it('returns gopls for .go', () => {
      const servers = getServersForExtension('.go', getBuiltinServers());
      expect(servers.map((s) => s.id)).toContain('gopls');
    });

    it('returns empty for unknown extension', () => {
      expect(
        getServersForExtension('.unknown_ext_x', getBuiltinServers()),
      ).toEqual([]);
    });
  });

  describe('user config merge behavior', () => {
    it('disables a built-in server when user sets empty command for same id', () => {
      const merged = mergeUserConfig(getBuiltinServers(), [
        customServer({ id: 'ts', command: '', extensions: ['.ts'] }),
      ]);
      expect(merged.map((s) => s.id)).not.toContain('ts');
    });

    it('adds a user custom server', () => {
      const merged = mergeUserConfig(getBuiltinServers(), [
        customServer({
          id: 'custom-lua',
          extensions: ['.lua'],
          command: 'lua-language-server',
        }),
      ]);
      expect(merged.map((s) => s.id)).toContain('custom-lua');
    });

    it('overrides command for same-id built-in', () => {
      const merged = mergeUserConfig(getBuiltinServers(), [
        customServer({
          id: 'ts',
          command: 'typescript-language-server-custom',
          extensions: ['.ts'],
        }),
      ]);
      const ts = merged.find((s) => s.id === 'ts');
      expect(ts?.command).toBe('typescript-language-server-custom');
    });

    it('registry method mergeUserConfig applies same behavior', () => {
      const registry = createServerRegistry();
      const merged = registry.mergeUserConfig([
        customServer({
          id: 'custom-zig',
          extensions: ['.zig'],
          command: 'zls',
        }),
      ]);
      expect(merged.map((s) => s.id)).toContain('custom-zig');
    });
  });

  describe('immutability and determinism', () => {
    it('getBuiltinServers is deterministic across calls (deep equal)', () => {
      expect(getBuiltinServers()).toEqual(getBuiltinServers());
    });

    it('getBuiltinServers returns arrays safe from caller mutation side-effects', () => {
      const first = getBuiltinServers().slice();
      first.push(customServer({ id: 'x1' }));
      const second = getBuiltinServers();
      expect(second.map((s) => s.id)).not.toContain('x1');
    });

    it('mergeUserConfig does not mutate builtins input', () => {
      const builtins = getBuiltinServers();
      const before = JSON.stringify(builtins);
      mergeUserConfig(builtins, [
        customServer({ id: 'custom-merge', command: 'merge-ls' }),
      ]);
      expect(JSON.stringify(builtins)).toBe(before);
    });
  });

  describe('property-based invariants', () => {
    it('merge with empty user config preserves built-ins ids', () => {
      fc.assert(
        fc.property(fc.constant(getBuiltinServers()), (builtins) => {
          const merged = mergeUserConfig(builtins, []);
          expect(merged.map((s) => s.id)).toEqual(builtins.map((s) => s.id));
        }),
      );
    });

    it('merge is deterministic for same inputs', () => {
      const userArb = fc.array(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 8 }),
          displayName: fc.string({ minLength: 1, maxLength: 16 }),
          extensions: fc.array(
            fc.constantFrom('.ts', '.js', '.go', '.py', '.rs', '.x'),
            {
              minLength: 1,
              maxLength: 3,
            },
          ),
          command: fc.string({ minLength: 0, maxLength: 16 }),
        }),
      ) as fc.Arbitrary<ServerRegistryEntry[]>;

      fc.assert(
        fc.property(userArb, (userConfig) => {
          const builtins = getBuiltinServers();
          const a = mergeUserConfig(builtins, userConfig);
          const b = mergeUserConfig(builtins, userConfig);
          expect(a).toEqual(b);
        }),
      );
    });

    it('lookup only returns servers that declare requested extension', () => {
      const extArb = fc.constantFrom(
        '.ts',
        '.go',
        '.py',
        '.rs',
        '.md',
        '.unknown-any',
      );
      fc.assert(
        fc.property(extArb, (ext) => {
          const servers = getServersForExtension(ext, getBuiltinServers());
          expect(servers.every((s) => s.extensions.includes(ext))).toBe(true);
        }),
      );
    });

    it('merge output has unique ids (set cardinality invariant)', () => {
      const userArb = fc.array(
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 10 }),
          displayName: fc.string({ minLength: 1, maxLength: 20 }),
          extensions: fc.array(
            fc.constantFrom('.ts', '.go', '.py', '.rs', '.x'),
            {
              minLength: 1,
              maxLength: 2,
            },
          ),
          command: fc.string({ minLength: 0, maxLength: 20 }),
        }),
      ) as fc.Arbitrary<ServerRegistryEntry[]>;

      fc.assert(
        fc.property(userArb, (userConfig) => {
          const merged = mergeUserConfig(getBuiltinServers(), userConfig);
          const ids = merged.map((s) => s.id);
          expect(new Set(ids).size).toBe(ids.length);
        }),
      );
    });

    it('createServerRegistry delegates extension lookup deterministically', () => {
      const extArb = fc.constantFrom('.ts', '.go', '.py', '.rs', '.unknown-z');
      fc.assert(
        fc.property(extArb, (ext) => {
          const registry = createServerRegistry(getBuiltinServers());
          expect(registry.getServersForExtension(ext)).toEqual(
            registry.getServersForExtension(ext),
          );
        }),
      );
    });
  });
});

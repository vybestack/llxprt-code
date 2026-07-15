/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scanner fixture/mutation tests proving the AST-based Gemini identifier
 * scanner correctly classifies:
 * - async/default/declare/multiline/re-export/non-export declarations
 * - comments, strings, and templates are NOT treated as identifiers
 *
 * These tests use synthetic fixture source strings (parsed in-memory via the
 * TypeScript compiler API) and mutation-style assertions. No real workspace
 * files are scanned here — that is the job of providerAgnosticNaming.test.ts.
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  extractDeclaredIdentifiers,
  hasGeminiIdentifier,
  shouldScanForGemini,
  type DeclaredIdentifier,
} from './geminiIdentifierScanner.js';

/** Parse a source string into a SourceFile for scanner testing. */
function parseSource(code: string, fileName = 'fixture.ts'): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** Extract Gemini-prefixed/matching declared identifiers from source code. */
function scanSource(code: string): DeclaredIdentifier[] {
  const sf = parseSource(code);
  return extractDeclaredIdentifiers(sf);
}

describe('GeminiIdentifierScanner fixture/mutation tests', () => {
  describe('exported declarations', () => {
    it('catches exported const', () => {
      const hits = scanSource('export const GeminiResult = 42;');
      expect(hits.some((h) => h.name === 'GeminiResult')).toBe(true);
    });

    it('catches exported function', () => {
      const hits = scanSource('export function refreshGeminiTools(): void {}');
      expect(hits.some((h) => h.name === 'refreshGeminiTools')).toBe(true);
    });

    it('catches exported async function', () => {
      const hits = scanSource(
        'export async function buildGeminiClient(): Promise<void> {}',
      );
      expect(hits.some((h) => h.name === 'buildGeminiClient')).toBe(true);
    });

    it('catches exported class', () => {
      const hits = scanSource('export class GeminiClient {}');
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });

    it('catches exported abstract class', () => {
      const hits = scanSource('export abstract class GeminiBaseClient {}');
      expect(hits.some((h) => h.name === 'GeminiBaseClient')).toBe(true);
    });

    it('catches exported interface', () => {
      const hits = scanSource('export interface GeminiEventType {}');
      expect(hits.some((h) => h.name === 'GeminiEventType')).toBe(true);
    });

    it('catches exported type alias', () => {
      const hits = scanSource(
        'export type GeminiErrorEventValue = { message: string };',
      );
      expect(hits.some((h) => h.name === 'GeminiErrorEventValue')).toBe(true);
    });

    it('catches exported enum', () => {
      const hits = scanSource('export enum GeminiMode { Auto, Manual }');
      expect(hits.some((h) => h.name === 'GeminiMode')).toBe(true);
    });

    it('catches exported default function', () => {
      const hits = scanSource(
        'export default function GeminiDefaultFn(): void {}',
      );
      expect(hits.some((h) => h.name === 'GeminiDefaultFn')).toBe(true);
    });

    it('catches exported default class', () => {
      const hits = scanSource('export default class GeminiDefault {}');
      expect(hits.some((h) => h.name === 'GeminiDefault')).toBe(true);
    });
  });

  describe('non-exported declarations', () => {
    it('catches non-exported const', () => {
      const hits = scanSource('const geminiResult = 42;');
      expect(hits.some((h) => h.name === 'geminiResult')).toBe(true);
    });

    it('catches non-exported function', () => {
      const hits = scanSource('function buildGeminiTools(): void {}');
      expect(hits.some((h) => h.name === 'buildGeminiTools')).toBe(true);
    });

    it('catches non-exported async function', () => {
      const hits = scanSource(
        'async function refreshGeminiTools(): Promise<void> {}',
      );
      expect(hits.some((h) => h.name === 'refreshGeminiTools')).toBe(true);
    });

    it('catches non-exported class', () => {
      const hits = scanSource('class GeminiChatSession {}');
      expect(hits.some((h) => h.name === 'GeminiChatSession')).toBe(true);
    });

    it('catches non-exported interface', () => {
      const hits = scanSource('interface GeminiConfig {}');
      expect(hits.some((h) => h.name === 'GeminiConfig')).toBe(true);
    });

    it('catches non-exported type alias', () => {
      const hits = scanSource('type GeminiStreamEvent = string;');
      expect(hits.some((h) => h.name === 'GeminiStreamEvent')).toBe(true);
    });

    it('catches non-exported enum', () => {
      const hits = scanSource('enum GeminiHookType { Before, After }');
      expect(hits.some((h) => h.name === 'GeminiHookType')).toBe(true);
    });
  });

  describe('declare forms', () => {
    it('catches declare const', () => {
      const hits = scanSource('declare const GEMINI_API_KEY: string;');
      expect(hits.some((h) => h.name === 'GEMINI_API_KEY')).toBe(true);
    });

    it('catches declare function', () => {
      const hits = scanSource('declare function getGeminiDir(): string;');
      expect(hits.some((h) => h.name === 'getGeminiDir')).toBe(true);
    });

    it('catches declare class', () => {
      const hits = scanSource('declare class GeminiExternalClient {}');
      expect(hits.some((h) => h.name === 'GeminiExternalClient')).toBe(true);
    });

    it('catches declare enum', () => {
      const hits = scanSource('declare enum GeminiExternalMode { Auto }');
      expect(hits.some((h) => h.name === 'GeminiExternalMode')).toBe(true);
    });
  });

  describe('multiline declarations', () => {
    it('catches multiline exported interface', () => {
      const code = [
        'export interface ServerGeminiStreamEvent {',
        '  type: string;',
        '  data: unknown;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'ServerGeminiStreamEvent')).toBe(true);
    });

    it('catches multiline exported type with union', () => {
      const code = [
        'export type GeminiEventType =',
        '  | { type: "a" }',
        '  | { type: "b" };',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiEventType')).toBe(true);
    });

    it('catches multiline variable declaration', () => {
      const code = [
        'const geminiResult = someFunction(',
        '  arg1,',
        '  arg2,',
        ');',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiResult')).toBe(true);
    });
  });

  describe('re-export forms', () => {
    it('catches named re-export', () => {
      const hits = scanSource(
        "export { GeminiClient } from './geminiClient.js';",
      );
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });

    it('catches aliased re-export (exported name)', () => {
      const hits = scanSource(
        "export { AgentClient as GeminiClient } from './client.js';",
      );
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });

    it('captures exact metadata for an aliased re-export source symbol', () => {
      const hits = scanSource(
        "export { GeminiClient as AgentClient } from './client.js';",
      );
      expect(hits).toContainEqual(
        expect.objectContaining({
          name: 'GeminiClient',
          kind: 'export-source',
          moduleSpecifier: './client.js',
          importedSymbol: 'GeminiClient',
        }),
      );
    });

    it('catches namespace re-export aliases', () => {
      const hits = scanSource("export * as GeminiApi from './api.js';");
      expect(hits).toContainEqual(
        expect.objectContaining({
          name: 'GeminiApi',
          kind: 'export-namespace',
          moduleSpecifier: './api.js',
          importedSymbol: '*',
        }),
      );
    });

    it('catches identifier export assignments', () => {
      const hits = scanSource(
        'const GeminiClient = {}; export default GeminiClient;',
      );
      expect(
        hits.some(
          (hit) => hit.name === 'GeminiClient' && hit.kind === 'export-default',
        ),
      ).toBe(true);
    });

    it('catches wildcard re-export', () => {
      // export * does not introduce a named identifier at this syntax level;
      // it should NOT produce a false positive.
      const hits = scanSource("export * from './gemini.js';");
      expect(hits).toHaveLength(0);
    });
  });

  describe('comments are not identifiers', () => {
    it('line comments are ignored', () => {
      const code = [
        '// This used to be a GeminiClient',
        'export const neutralResult = 42;',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(false);
    });

    it('block comments are ignored', () => {
      const code = [
        '/*',
        ' * GeminiClient was the old name.',
        ' */',
        'export const neutralResult = 42;',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(false);
    });

    it('inline block comments are ignored', () => {
      const code = 'export const neutralResult = /* GeminiClient */ 42;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(false);
    });

    it('JSDoc comments are ignored', () => {
      const code = [
        '/**',
        ' * @deprecated Use GeminiClient instead.',
        ' */',
        'export const neutralResult = 42;',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(false);
    });
  });

  describe('strings and templates are not identifiers', () => {
    it('string literals are not identifiers', () => {
      const code = "export const msg = 'Error initializing Gemini chat';";
      const hits = scanSource(code);
      expect(hits.some((h) => /Gemini/.test(h.name))).toBe(false);
    });

    it('template literals are not identifiers', () => {
      const code =
        'export const msg = `Error initializing Gemini chat for ${name}`;';
      const hits = scanSource(code);
      expect(hits.some((h) => /Gemini/.test(h.name))).toBe(false);
    });

    it('tagged template literals are not identifiers', () => {
      const code = 'sql`SELECT * FROM GeminiTable`;';
      const hits = scanSource(code);
      expect(hits.some((h) => /Gemini/.test(h.name))).toBe(false);
    });
  });

  describe('non-Gemini identifiers are not flagged', () => {
    it('neutral names are not flagged', () => {
      const code = [
        'export const agentResult = 42;',
        'export interface AgentEventType {}',
        'export class AgentClient {}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });
  });

  describe('hasGeminiIdentifier convenience function', () => {
    it('returns true when a Gemini identifier exists', () => {
      const code = 'export const GeminiResult = 42;';
      const sf = parseSource(code);
      expect(hasGeminiIdentifier(sf)).toBe(true);
    });

    it('returns false when no Gemini identifier exists', () => {
      const code = 'export const agentResult = 42;';
      const sf = parseSource(code);
      expect(hasGeminiIdentifier(sf)).toBe(false);
    });

    it('returns false for comments only', () => {
      const code = '// GeminiClient comment only';
      const sf = parseSource(code);
      expect(hasGeminiIdentifier(sf)).toBe(false);
    });
  });

  describe('shouldScanForGemini prefilter', () => {
    it('returns true when source text contains gemini (lowercase)', () => {
      expect(shouldScanForGemini('const x = geminiThing;', 'neutral.ts')).toBe(
        true,
      );
    });

    it('returns true when source text contains Gemini (capitalized)', () => {
      expect(
        shouldScanForGemini('export class GeminiClient {}', 'neutral.ts'),
      ).toBe(true);
    });

    it('returns true when source text contains GEMINI (uppercase)', () => {
      expect(shouldScanForGemini('const GEMINI_DIR = ".";', 'neutral.ts')).toBe(
        true,
      );
    });

    it('returns true when filename contains gemini but text does not', () => {
      expect(
        shouldScanForGemini('const agentResult = 42;', 'geminiHandler.ts'),
      ).toBe(true);
    });

    it('returns false when neither text nor filename contains gemini', () => {
      expect(shouldScanForGemini('const agentResult = 42;', 'neutral.ts')).toBe(
        false,
      );
    });

    it('returns false for empty source and neutral filename', () => {
      expect(shouldScanForGemini('', 'neutral.ts')).toBe(false);
    });

    it('preserves correctness: gemini in a string still triggers prefilter', () => {
      // The prefilter is conservative — if "gemini" appears ANYWHERE in the
      // text (even in a string), the file is a candidate for AST scanning.
      // The AST scanner then correctly ignores strings.
      expect(
        shouldScanForGemini(
          "const msg = 'Error initializing Gemini chat';",
          'neutral.ts',
        ),
      ).toBe(true);
    });
  });

  describe('GEMINI_ uppercase constant variants', () => {
    it('catches exported const GEMINI_*', () => {
      const hits = scanSource('export const GEMINI_DIR = ".gemini";');
      expect(hits.some((h) => h.name === 'GEMINI_DIR')).toBe(true);
    });

    it('catches non-exported const GEMINI_*', () => {
      const hits = scanSource('const GEMINI_PATTERNS = [];');
      expect(hits.some((h) => h.name === 'GEMINI_PATTERNS')).toBe(true);
    });
  });

  describe('hook/function and UI component patterns', () => {
    it('catches hook function useGeminiStream', () => {
      const hits = scanSource('export function useGeminiStream(): void {}');
      expect(hits.some((h) => h.name === 'useGeminiStream')).toBe(true);
    });

    it('catches arrow function variable', () => {
      const hits = scanSource('const GeminiMessage = () => null;');
      expect(hits.some((h) => h.name === 'GeminiMessage')).toBe(true);
    });

    it('catches React component-style const (arrow)', () => {
      const code = [
        'export const GeminiRespondingSpinner = ({ visible }: { visible: boolean }) => {',
        '  return null;',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiRespondingSpinner')).toBe(true);
    });
  });

  // ---- Extended declaration categories (issue #2537) ----

  describe('exported variable detection via VariableStatement traversal', () => {
    it('marks exported const as exported=true', () => {
      const hits = scanSource('export const GeminiResult = 42;');
      const hit = hits.find((h) => h.name === 'GeminiResult');
      expect(hit).toBeDefined();
      expect(hit?.exported).toBe(true);
    });

    it('marks non-exported const as exported=false', () => {
      const hits = scanSource('const geminiResult = 42;');
      const hit = hits.find((h) => h.name === 'geminiResult');
      expect(hit).toBeDefined();
      expect(hit?.exported).toBe(false);
    });

    it('marks multi-declaration exported const correctly', () => {
      const code = 'export const GeminiResult = 1, other = 2;';
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiResult');
      expect(hit).toBeDefined();
      expect(hit?.exported).toBe(true);
    });

    it('marks exported let correctly', () => {
      const code = 'export let geminiState = 0;';
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'geminiState');
      expect(hit).toBeDefined();
      expect(hit?.exported).toBe(true);
    });
  });

  describe('class methods', () => {
    it('catches Gemini-named method', () => {
      const code = [
        'export class AgentClient {',
        '  refreshGeminiTools(): void {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'refreshGeminiTools')).toBe(true);
    });

    it('catches Gemini-named async method', () => {
      const code = [
        'export class AgentClient {',
        '  async setupGeminiClient(): Promise<void> {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'setupGeminiClient')).toBe(true);
    });

    it('catches Gemini-named private method', () => {
      const code = [
        'export class AgentClient {',
        '  private buildGeminiRequest(): void {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'buildGeminiRequest')).toBe(true);
    });
  });

  describe('class properties', () => {
    it('catches Gemini-named property', () => {
      const code = [
        'export class AgentClient {',
        '  geminiClient: unknown;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini-named private property', () => {
      const code = [
        'export class AgentClient {',
        '  private geminiResult = 0;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiResult')).toBe(true);
    });

    it('catches Gemini-named readonly property', () => {
      const code = [
        'export class AgentClient {',
        '  readonly geminiMode = "auto";',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiMode')).toBe(true);
    });
  });

  describe('getters and setters', () => {
    it('catches Gemini-named getter', () => {
      const code = [
        'export class AgentClient {',
        '  get geminiConfig(): unknown { return null; }',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiConfig')).toBe(true);
    });

    it('catches Gemini-named setter', () => {
      const code = [
        'export class AgentClient {',
        '  set geminiConfig(val: unknown) {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiConfig')).toBe(true);
    });
  });

  describe('method/property signatures (interface/type)', () => {
    it('catches Gemini-named method signature in interface', () => {
      const code = [
        'export interface AgentClient {',
        '  refreshGeminiTools(): void;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'refreshGeminiTools')).toBe(true);
    });

    it('catches Gemini-named property signature in interface', () => {
      const code = [
        'export interface AgentConfig {',
        '  geminiClient: unknown;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });
  });

  describe('function/method parameters', () => {
    it('catches Gemini-named function parameter', () => {
      const code = 'export function process(geminiClient: unknown): void {}';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini-named method parameter', () => {
      const code = [
        'export class AgentClient {',
        '  process(geminiRequest: unknown): void {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiRequest')).toBe(true);
    });

    it('catches Gemini-named arrow function parameter', () => {
      const code = 'const handler = (geminiEvent: unknown): void => {};';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiEvent')).toBe(true);
    });

    it('catches Gemini-named destructured function parameter', () => {
      const code =
        'export function process({ geminiClient }: { geminiClient: unknown }): void {}';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });
  });

  describe('import aliases (named import with alias)', () => {
    it('catches named import alias to Gemini name', () => {
      const code = "import { Client as GeminiClient } from './client.js';";
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });

    it('catches named import with Gemini local name (no alias)', () => {
      const code = "import { GeminiClient } from './client.js';";
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });
  });

  describe('import default alias', () => {
    it('catches default import with Gemini alias', () => {
      const code = "import GeminiClient from './client.js';";
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });
  });

  describe('import namespace alias', () => {
    it('catches namespace import with Gemini alias', () => {
      const code = "import * as GeminiModule from './gemini.js';";
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiModule')).toBe(true);
    });
  });

  // ---- Extended import metadata (issue #2537 finding 3) ----

  describe('import tuple metadata: moduleSpecifier and importedSymbol', () => {
    it('captures moduleSpecifier for named import', () => {
      const code =
        "import { GeminiClient } from '@vybestack/llxprt-code-core';";
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiClient');
      expect(hit).toBeDefined();
      expect(hit?.moduleSpecifier).toBe('@vybestack/llxprt-code-core');
    });

    it('captures importedSymbol equal to name when no alias', () => {
      const code = "import { GeminiClient } from './client.js';";
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiClient');
      expect(hit).toBeDefined();
      expect(hit?.importedSymbol).toBe('GeminiClient');
    });

    it('captures importedSymbol (source name) separately from local alias', () => {
      const code = "import { Client as GeminiClient } from './client.js';";
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiClient');
      expect(hit).toBeDefined();
      expect(hit?.importedSymbol).toBe('Client');
      expect(hit?.name).toBe('GeminiClient');
    });

    it('captures moduleSpecifier for aliased import', () => {
      const code =
        "import { Client as GeminiClient } from '@scope/pkg/sub.js';";
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiClient');
      expect(hit).toBeDefined();
      expect(hit?.moduleSpecifier).toBe('@scope/pkg/sub.js');
    });

    it('captures moduleSpecifier for default import', () => {
      const code = "import GeminiClient from './client.js';";
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiClient');
      expect(hit).toBeDefined();
      expect(hit?.moduleSpecifier).toBe('./client.js');
      expect(hit?.importedSymbol).toBe('default');
    });

    it('captures moduleSpecifier for namespace import', () => {
      const code = "import * as GeminiModule from './gemini.js';";
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiModule');
      expect(hit).toBeDefined();
      expect(hit?.moduleSpecifier).toBe('./gemini.js');
      expect(hit?.importedSymbol).toBe('*');
    });

    it('does NOT set moduleSpecifier on non-import declarations', () => {
      const code = 'export const GeminiResult = 42;';
      const hits = scanSource(code);
      const hit = hits.find((h) => h.name === 'GeminiResult');
      expect(hit).toBeDefined();
      expect(hit?.moduleSpecifier).toBeUndefined();
      expect(hit?.importedSymbol).toBeUndefined();
    });
  });

  describe('enum members', () => {
    it('catches Gemini-named enum member', () => {
      const code = [
        'export enum ProviderMode {',
        '  GeminiMode = "gemini",',
        '  AgentMode = "agent",',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiMode')).toBe(true);
    });

    it('catches Gemini-named enum member in const enum', () => {
      const code = [
        'const enum ProviderType {',
        '  GeminiType = "gemini",',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiType')).toBe(true);
    });
  });

  describe('named class/function expressions', () => {
    it('catches named class expression assigned to variable', () => {
      const code = 'export const client = class GeminiClientImpl {};';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClientImpl')).toBe(true);
    });

    it('catches named function expression assigned to variable', () => {
      const code = 'export const fn = function GeminiHandler(): void {};';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiHandler')).toBe(true);
    });

    it('catches named function expression as argument', () => {
      const code = ['registerHandler(function GeminiHandler(): void {});'].join(
        '\n',
      );
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiHandler')).toBe(true);
    });
  });

  describe('nested binding identifiers (destructuring)', () => {
    it('catches Gemini name in object destructuring', () => {
      const code = 'const { geminiClient, agentClient } = obj;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini name in array destructuring', () => {
      const code = 'const [geminiFirst, agentSecond] = arr;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiFirst')).toBe(true);
    });

    it('catches Gemini name in nested destructuring', () => {
      const code = 'const { outer: { geminiInner } } = obj;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiInner')).toBe(true);
    });

    it('catches Gemini name with destructuring rename', () => {
      const code = 'const { client: geminiClient } = obj;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });
  });

  describe('forbidden name in neutral provider code (regression)', () => {
    it('catches GeminiClient class in neutral provider code', () => {
      // Simulates a neutral provider file that should not declare GeminiClient
      const code = [
        'export class GeminiClient {',
        '  geminiClient: unknown;',
        '  refreshGeminiTools(): void {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      // Should catch the class, property, and method
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
      expect(hits.some((h) => h.name === 'refreshGeminiTools')).toBe(true);
    });
  });

  describe('neutral identifiers are never flagged (extended)', () => {
    it('methods, properties, params with neutral names are not flagged', () => {
      const code = [
        'export class AgentClient {',
        '  agentClient: unknown;',
        '  refreshAgentTools(): void {}',
        '  process(agentRequest: unknown): void {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });

    it('neutral imports are not flagged', () => {
      const code = "import { Client as AgentClient } from './client.js';";
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });

    it('neutral enum members are not flagged', () => {
      const code = [
        'export enum ProviderMode {',
        '  AgentMode = "agent",',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });
  });

  // ---- Extended parameter/signature categories (issue #2537 finding 3) ----

  describe('constructor parameters and parameter properties', () => {
    it('catches Gemini-named constructor parameter', () => {
      const code = [
        'export class AgentClient {',
        '  constructor(geminiClient: unknown) {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini-named constructor parameter property', () => {
      const code = [
        'export class AgentClient {',
        '  constructor(public geminiClient: unknown) {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini-named private constructor parameter property', () => {
      const code = [
        'export class AgentClient {',
        '  constructor(private geminiResult: number) {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiResult')).toBe(true);
    });

    it('catches Gemini-named readonly constructor parameter property', () => {
      const code = [
        'export class AgentClient {',
        '  constructor(readonly geminiMode: string) {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiMode')).toBe(true);
    });

    it('catches Gemini-named destructured constructor parameter', () => {
      const code = [
        'export class AgentClient {',
        '  constructor({ geminiClient }: { geminiClient: unknown }) {}',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });
  });

  describe('function-expression parameters', () => {
    it('catches Gemini-named parameter in named function expression', () => {
      const code =
        'const fn = function handler(geminiRequest: unknown): void {};';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiRequest')).toBe(true);
    });

    it('catches Gemini-named parameter in anonymous function expression', () => {
      const code = 'const fn = function (geminiRequest: unknown): void {};';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiRequest')).toBe(true);
    });

    it('catches Gemini-named parameter in arrow function passed as argument', () => {
      const code = 'registerHandler((geminiEvent: unknown) => {});';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiEvent')).toBe(true);
    });
  });

  describe('call signatures', () => {
    it('catches Gemini-named parameter in interface call signature', () => {
      const code = [
        'export interface AgentHandler {',
        '  (geminiRequest: unknown): void;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiRequest')).toBe(true);
    });

    it('catches Gemini-named parameter in type literal call signature', () => {
      const code =
        'export type AgentHandler = (geminiRequest: unknown) => void;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiRequest')).toBe(true);
    });
  });
});

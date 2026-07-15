/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extended scanner fixture/mutation tests for newer declaration categories:
 * - import = require (ImportEqualsDeclaration)
 * - type parameters (generics)
 * - exported object-literal static property and method names
 *
 * Split from geminiIdentifierScanner.test.ts to keep both files under
 * max-lines. Uses the same synthetic fixture approach and imports the same
 * scanner under test.
 *
 * @plan:PLAN-20260608-ISSUE1423.P03
 */

import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  extractDeclaredIdentifiers,
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

// ---- Finding 7: ImportEquals, type parameters, exported object-literal static property/method names ----

describe('GeminiIdentifierScanner extended fixture/mutation tests', () => {
  describe('import = require (ImportEqualsDeclaration)', () => {
    it('catches import = require with Gemini alias', () => {
      const code = 'import GeminiModule = require("./gemini.js");';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiModule')).toBe(true);
    });

    it('catches import = require with Gemini alias (capitalized)', () => {
      const code = 'import GeminiClient = require("./client.js");';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'GeminiClient')).toBe(true);
    });

    it('does not flag neutral import = require', () => {
      const code = 'import agentModule = require("./agent.js");';
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });
  });

  describe('type parameters (generics)', () => {
    it('catches Gemini-named type parameter on a class', () => {
      const code = 'export class AgentClient<TGemini> { value: TGemini; }';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'TGemini')).toBe(true);
    });

    it('catches Gemini-named type parameter on an interface', () => {
      const code = 'export interface AgentRepo<TGemini> { get(): TGemini; }';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'TGemini')).toBe(true);
    });

    it('catches Gemini-named type parameter on a function', () => {
      const code = 'export function process<TGemini>(input: TGemini): void {}';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'TGemini')).toBe(true);
    });

    it('catches Gemini-named type parameter on a type alias', () => {
      const code = 'export type AgentResult<TGemini> = TGemini | null;';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'TGemini')).toBe(true);
    });

    it('catches multiple type parameters including Gemini-named', () => {
      const code = 'export class AgentClient<TAgent, TGemini> {}';
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'TGemini')).toBe(true);
    });

    it('does not flag neutral type parameters', () => {
      const code = 'export class AgentClient<TAgent> { value: TAgent; }';
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });
  });

  describe('exported object-literal static property and method names', () => {
    it('catches Gemini-named property in exported object literal', () => {
      const code = [
        'export const AgentFactory = {',
        '  geminiClient: null,',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini-named method in exported object literal', () => {
      const code = [
        'export const AgentFactory = {',
        '  refreshGeminiTools() {',
        '    return null;',
        '  },',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'refreshGeminiTools')).toBe(true);
    });

    it('catches Gemini-named async method in exported object literal', () => {
      const code = [
        'export const AgentFactory = {',
        '  async buildGeminiClient() {',
        '    return null;',
        '  },',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'buildGeminiClient')).toBe(true);
    });

    it('catches Gemini-named shorthand property in exported object literal', () => {
      const code = [
        'const geminiValue = 42;',
        'export const AgentFactory = {',
        '  geminiValue,',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiValue')).toBe(true);
    });

    it('catches multiple Gemini-named properties in object literal', () => {
      const code = [
        'export const AgentFactory = {',
        '  geminiClient: null,',
        '  geminiResult: 42,',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
      expect(hits.some((h) => h.name === 'geminiResult')).toBe(true);
    });

    it('does not flag neutral properties in object literal', () => {
      const code = [
        'export const AgentFactory = {',
        '  agentClient: null,',
        '  refreshAgentTools() {},',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });
  });
  describe('construct signatures', () => {
    it('catches Gemini-named parameter in interface construct signature', () => {
      const code = [
        'export interface AgentConstructor {',
        '  new (geminiClient: unknown): AgentClient;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiClient')).toBe(true);
    });

    it('catches Gemini-named parameter in type literal construct signature', () => {
      const code = [
        'export type AgentConstructor = {',
        '  new (geminiConfig: unknown): AgentClient;',
        '};',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits.some((h) => h.name === 'geminiConfig')).toBe(true);
    });
  });

  describe('neutral extended signature categories are not flagged', () => {
    it('neutral constructor params, function-expr params, call/construct sigs are not flagged', () => {
      const code = [
        'export class AgentClient {',
        '  constructor(public agentClient: unknown) {}',
        '}',
        'const fn = function handler(agentRequest: unknown): void {};',
        'export interface AgentHandler {',
        '  (agentRequest: unknown): void;',
        '}',
        'export interface AgentConstructor {',
        '  new (agentClient: unknown): AgentClient;',
        '}',
      ].join('\n');
      const hits = scanSource(code);
      expect(hits).toHaveLength(0);
    });
  });
});

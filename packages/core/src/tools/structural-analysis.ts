/**
 * Multi-hop AST-based code analysis tool.
 * Analyzes code relationships: call graphs, type hierarchies, symbol references,
 * module dependencies, and exports using @ast-grep/napi.
 *
 * This is name-based (not type-resolved) analysis. See overview.md for limitations.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import FastGlob from 'fast-glob';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { makeRelative } from '../utils/paths.js';
import type { SgNode, NapiConfig } from '@ast-grep/napi';
import type { Lang } from '../utils/ast-grep-utils.js';
import {
  parse,
  getAstLanguage,
  LANGUAGE_MAP,
} from '../utils/ast-grep-utils.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

const VALID_MODES = [
  'callers',
  'callees',
  'definitions',
  'hierarchy',
  'references',
  'dependencies',
  'exports',
] as const;
type Mode = (typeof VALID_MODES)[number];

const DEFAULT_DEPTH = 1;
const MAX_DEPTH = 5;
const DEFAULT_MAX_NODES = 50;

export interface StructuralAnalysisParams {
  mode: string;
  language: string;
  path?: string;
  symbol?: string;
  depth?: number;
  maxNodes?: number;
  target?: string;
  reverse?: boolean;
}

interface AnalysisResult {
  mode: string;
  symbol?: string;
  truncated: boolean;
  results: unknown;
}

class StructuralAnalysisInvocation extends BaseToolInvocation<
  StructuralAnalysisParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: StructuralAnalysisParams,
    messageBus: MessageBus,
  ) {
    super(params, messageBus);
  }

  getDescription(): string {
    const { mode, symbol } = this.params;
    if (symbol) return `${mode}: ${symbol}`;
    return `${mode} analysis`;
  }

  private makeError(message: string): ToolResult {
    return { llmContent: message, returnDisplay: message };
  }

  private formatResult(analysisResult: AnalysisResult): ToolResult {
    const llmContent = JSON.stringify(analysisResult, null, 2);
    const mode = analysisResult.mode;
    const symbol = analysisResult.symbol ? ` for ${analysisResult.symbol}` : '';
    const displayMessage = `${mode} analysis${symbol} complete${analysisResult.truncated ? ' (truncated)' : ''}`;
    return {
      llmContent,
      returnDisplay: displayMessage,
      metadata: analysisResult as unknown as Record<string, unknown>,
    };
  }

  private validateAndResolveParams():
    | {
        mode: string;
        resolvedLang: string | Lang;
        searchPath: string;
        targetDir: string;
        symbol: string | undefined;
        depth: number;
        maxNodes: number;
        reverse: boolean;
      }
    | ToolResult {
    const { mode, language, symbol, depth, maxNodes, target, reverse } =
      this.params;

    if (!VALID_MODES.includes(mode as Mode)) {
      return this.makeError(
        `Error: Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(', ')}`,
      );
    }

    if (!language) {
      return this.makeError('Error: `language` parameter is required.');
    }
    const resolvedLang = getAstLanguage(language);
    if (!resolvedLang) {
      return this.makeError(
        `Error: Unrecognized language "${language}". Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}`,
      );
    }

    const targetDir = this.config.getTargetDir();
    let searchPath = this.params.path ?? target ?? targetDir;
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(targetDir, searchPath);
    }

    const normalizedTarget = targetDir.endsWith(path.sep)
      ? targetDir
      : targetDir + path.sep;
    if (searchPath !== targetDir && !searchPath.startsWith(normalizedTarget)) {
      return this.makeError('Error: Path resolves outside the workspace root.');
    }

    const symbolModes: Mode[] = [
      'callers',
      'callees',
      'definitions',
      'hierarchy',
      'references',
    ];
    if (symbolModes.includes(mode as Mode) && !symbol) {
      return this.makeError(
        `Error: \`symbol\` parameter is required for "${mode}" mode.`,
      );
    }

    return {
      mode,
      resolvedLang,
      searchPath,
      targetDir,
      symbol,
      depth: Math.min(depth ?? DEFAULT_DEPTH, MAX_DEPTH),
      maxNodes: maxNodes ?? DEFAULT_MAX_NODES,
      reverse: reverse === true,
    };
  }

  private async dispatchMode(
    mode: string,
    resolvedLang: string | Lang,
    searchPath: string,
    targetDir: string,
    symbol: string | undefined,
    effectiveDepth: number,
    effectiveMaxNodes: number,
    reverse: boolean,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    switch (mode as Mode) {
      case 'definitions':
        return this.executeDefinitions(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          signal,
        );
      case 'hierarchy':
        return this.executeHierarchy(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          signal,
        );
      case 'callers':
        return this.executeCallers(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          effectiveDepth,
          effectiveMaxNodes,
          signal,
        );
      case 'callees':
        return this.executeCallees(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          effectiveDepth,
          effectiveMaxNodes,
          signal,
        );
      case 'references':
        return this.executeReferences(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          signal,
        );
      case 'dependencies':
        return this.executeDependencies(
          searchPath,
          resolvedLang,
          targetDir,
          reverse,
          signal,
        );
      case 'exports':
        return this.executeExports(searchPath, resolvedLang, targetDir, signal);
      default:
        throw new Error(`Mode "${mode}" is not implemented.`);
    }
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const params = this.validateAndResolveParams();
    if ('llmContent' in params) return params;

    const {
      mode,
      resolvedLang,
      searchPath,
      targetDir,
      symbol,
      depth: effectiveDepth,
      maxNodes: effectiveMaxNodes,
      reverse,
    } = params;

    try {
      const analysisResult = await this.dispatchMode(
        mode,
        resolvedLang,
        searchPath,
        targetDir,
        symbol,
        effectiveDepth,
        effectiveMaxNodes,
        reverse,
        signal,
      );
      return this.formatResult(analysisResult);
    } catch (err) {
      if (err instanceof Error && err.message.endsWith('is not implemented.')) {
        return this.makeError(`Error: ${err.message}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(`Error in ${mode}: ${msg}`);
    }
  }

  private async getFiles(
    searchPath: string,
    lang: string | Lang,
  ): Promise<string[]> {
    const stat = await fs.stat(searchPath).catch(() => null);
    if (stat !== null && stat.isFile() === true) {
      return [searchPath];
    }
    const extensions = this.getExtensionsForLanguage(lang);
    return FastGlob(
      extensions.map((ext) => `**/*.${ext}`),
      {
        cwd: searchPath,
        absolute: true,
        dot: false,
        ignore: ['**/node_modules/**', '**/.git/**'],
      },
    );
  }

  private getExtensionsForLanguage(lang: string | Lang): string[] {
    const exts: string[] = [];
    for (const [ext, mapped] of Object.entries(LANGUAGE_MAP)) {
      if (mapped === lang) exts.push(ext);
    }
    return exts.length > 0 ? exts : ['*'];
  }

  private escapeRegex(s: string): string {
    // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * AST node kinds that represent function-like containers.
   * Used for callers mode to find the scope a call lives in.
   */
  private static readonly FUNCTION_CONTAINER_KINDS = new Set([
    'method_definition',
    'function_declaration',
    'arrow_function',
  ]);

  /**
   * Extract a name from a function-like container node.
   * - method_definition: first property_identifier child
   * - function_declaration: first identifier child
   * - arrow_function: name from parent variable_declarator's identifier
   */
  private getContainerName(node: SgNode): string | null {
    const kind = String(node.kind());

    if (kind === 'method_definition') {
      const nameNode = node
        .children()
        .find((c: SgNode) => String(c.kind()) === 'property_identifier');
      return nameNode?.text() ?? null;
    }

    if (kind === 'function_declaration') {
      const nameNode = node
        .children()
        .find((c: SgNode) => String(c.kind()) === 'identifier');
      return nameNode?.text() ?? null;
    }

    if (kind === 'arrow_function') {
      // Walk up to variable_declarator → get its identifier
      const parent = node.parent();
      if (parent && String(parent.kind()) === 'variable_declarator') {
        const nameNode = parent
          .children()
          .find((c: SgNode) => String(c.kind()) === 'identifier');
        return nameNode?.text() ?? null;
      }
      return null;
    }

    return null;
  }

  private async parseFile(
    filePath: string,
    lang: string | Lang,
  ): Promise<{ root: SgNode; content: string } | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const result = parse(lang as Lang, content);
      return { root: result.root(), content };
    } catch {
      return null;
    }
  }

  /**
   * Extracts the function/method name from a call_expression node.
   * Handles: `foo()` → "foo", `obj.bar()` → "bar", `a.b.c()` → "c"
   */
  private extractCalleeName(callNode: SgNode): string | null {
    const children = callNode.children();
    if (children.length === 0) return null;
    const callee = children[0]; // first child of call_expression is the callee
    const kind = String(callee.kind());
    if (kind === 'identifier') {
      return callee.text();
    }
    if (kind === 'member_expression') {
      // Last property_identifier child is the method name
      const props = callee
        .children()
        .filter((c: SgNode) => String(c.kind()) === 'property_identifier');
      if (props.length > 0) {
        return props[props.length - 1].text();
      }
    }
    return null;
  }

  // ===== DEFINITIONS =====
  private searchDefinitionPatterns(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    definitions: Array<{
      file: string;
      line: number;
      kind: string;
      text: string;
    }>,
  ): void {
    const patterns = [
      { pat: `${symbol}($$$PARAMS) { $$$BODY }`, kind: 'method' },
      { pat: `function ${symbol}($$$PARAMS) { $$$BODY }`, kind: 'function' },
      { pat: `class ${symbol} { $$$BODY }`, kind: 'class' },
      { pat: `class ${symbol} extends $PARENT { $$$BODY }`, kind: 'class' },
    ];

    for (const { pat, kind } of patterns) {
      try {
        const matches = parsed.root.findAll(pat);
        for (const m of matches) {
          const range = m.range();
          definitions.push({
            file: relPath,
            line: range.start.line + 1,
            kind,
            text: m.text().substring(0, 200),
          });
        }
      } catch {
        // Pattern may not be valid for all languages
      }
    }
  }

  private searchDeclarationRules(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    definitions: Array<{
      file: string;
      line: number;
      kind: string;
      text: string;
    }>,
  ): void {
    try {
      const ruleMatches = parsed.root.findAll({
        rule: {
          any: [
            {
              kind: 'class_declaration',
              has: {
                kind: 'type_identifier',
                regex: `^${this.escapeRegex(symbol)}$`,
              },
            },
            {
              kind: 'interface_declaration',
              has: {
                kind: 'type_identifier',
                regex: `^${this.escapeRegex(symbol)}$`,
              },
            },
            {
              kind: 'type_alias_declaration',
              has: {
                kind: 'type_identifier',
                regex: `^${this.escapeRegex(symbol)}$`,
              },
            },
          ],
        },
      } as NapiConfig);
      for (const m of ruleMatches) {
        const range = m.range();
        const exists = definitions.some(
          (d) => d.file === relPath && d.line === range.start.line + 1,
        );
        if (!exists) {
          definitions.push({
            file: relPath,
            line: range.start.line + 1,
            kind: String(m.kind()),
            text: m.text().substring(0, 200),
          });
        }
      }
    } catch {
      // Rule may not apply
    }
  }

  private async executeDefinitions(
    symbol: string,
    lang: string | Lang,
    searchPath: string,
    workspaceRoot: string,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const definitions: Array<{
      file: string;
      line: number;
      kind: string;
      text: string;
    }> = [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);
      this.searchDefinitionPatterns(parsed, symbol, relPath, definitions);
      this.searchDeclarationRules(parsed, symbol, relPath, definitions);
    }

    return {
      mode: 'definitions',
      symbol,
      truncated: false,
      results: definitions,
    };
  }

  // ===== HIERARCHY =====
  private findSymbolParents(
    parsed: { root: SgNode },
    symbol: string,
    extendsParent: string[],
    implementsInterfaces: string[],
  ): void {
    try {
      const extendsMatches = parsed.root.findAll(
        `class ${symbol} extends $PARENT { $$$BODY }`,
      );
      for (const m of extendsMatches) {
        const parent = m.getMatch('PARENT');
        if (parent) extendsParent.push(parent.text());
      }
    } catch {
      /* skip */
    }

    try {
      const implMatches = parsed.root.findAll(
        `class ${symbol} implements $IFACE { $$$BODY }`,
      );
      for (const m of implMatches) {
        const iface = m.getMatch('IFACE');
        if (iface) implementsInterfaces.push(iface.text());
      }
    } catch {
      /* skip */
    }
  }

  private findSymbolChildren(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    extendedBy: Array<{ name: string; file: string; line: number }>,
    implementedBy: Array<{ name: string; file: string; line: number }>,
  ): void {
    try {
      const childMatches = parsed.root.findAll(
        `class $NAME extends ${symbol} { $$$BODY }`,
      );
      for (const m of childMatches) {
        const name = m.getMatch('NAME');
        if (name) {
          extendedBy.push({
            name: name.text(),
            file: relPath,
            line: m.range().start.line + 1,
          });
        }
      }
    } catch {
      /* skip */
    }

    try {
      const implByMatches = parsed.root.findAll(
        `class $NAME implements ${symbol} { $$$BODY }`,
      );
      for (const m of implByMatches) {
        const name = m.getMatch('NAME');
        if (name) {
          implementedBy.push({
            name: name.text(),
            file: relPath,
            line: m.range().start.line + 1,
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  private async executeHierarchy(
    symbol: string,
    lang: string | Lang,
    searchPath: string,
    workspaceRoot: string,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const extendsParent: string[] = [];
    const implementsInterfaces: string[] = [];
    const extendedBy: Array<{ name: string; file: string; line: number }> = [];
    const implementedBy: Array<{ name: string; file: string; line: number }> =
      [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);
      this.findSymbolParents(
        parsed,
        symbol,
        extendsParent,
        implementsInterfaces,
      );
      this.findSymbolChildren(
        parsed,
        symbol,
        relPath,
        extendedBy,
        implementedBy,
      );
    }

    return {
      mode: 'hierarchy',
      symbol,
      truncated: false,
      results: {
        extends: extendsParent,
        implements: implementsInterfaces,
        extendedBy,
        implementedBy,
      },
    };
  }

  // ===== CALLERS =====
  // @plan PLAN-20260211-ASTGREP.P09

  private findFunctionContainer(node: SgNode): SgNode | null {
    let container: SgNode | null = node.parent();
    while (
      container &&
      !StructuralAnalysisInvocation.FUNCTION_CONTAINER_KINDS.has(
        String(container.kind()),
      )
    ) {
      container = container.parent();
    }
    return container;
  }

  private getViaContext(callNode: SgNode): string {
    let node: SgNode = callNode;
    let parentNode = node.parent();
    while (parentNode) {
      const parentKind = String(parentNode.kind());
      if (
        parentKind.includes('statement') ||
        StructuralAnalysisInvocation.FUNCTION_CONTAINER_KINDS.has(parentKind)
      ) {
        break;
      }
      node = parentNode;
      parentNode = node.parent();
    }
    return node.text().trim().substring(0, 200);
  }

  private buildCallerEntry(
    callNode: SgNode,
    sym: string,
    relPath: string,
    visited: Set<string>,
    via?: string,
  ): { method: string; file: string; line: number; via: string } | undefined {
    const container = this.findFunctionContainer(callNode);
    if (container === null) {
      return undefined;
    }

    const methodName = this.getContainerName(container);
    if (methodName === null || methodName === '' || methodName === sym) {
      return undefined;
    }

    const key = `${methodName}@${relPath}`;
    if (visited.has(key)) {
      return undefined;
    }
    visited.add(key);

    return {
      method: methodName,
      file: relPath,
      line: container.range().start.line + 1,
      via: via ?? this.getViaContext(callNode),
    };
  }

  private findMemberCallCallers(
    parsed: { root: SgNode },
    sym: string,
    relPath: string,
    visited: Set<string>,
    ctx: {
      nodesVisited: number;
      maxNodes: number;
      truncated: boolean;
      signal: AbortSignal;
    },
  ): Array<{ method: string; file: string; line: number; via: string }> {
    const results: Array<{
      method: string;
      file: string;
      line: number;
      via: string;
    }> = [];
    try {
      const memberCalls = parsed.root.findAll({
        rule: {
          kind: 'member_expression',
          has: {
            kind: 'property_identifier',
            regex: `^${this.escapeRegex(sym)}$`,
          },
        },
      } as NapiConfig);

      for (const callNode of memberCalls) {
        if (ctx.nodesVisited >= ctx.maxNodes) {
          ctx.truncated = true;
          break;
        }

        const entry = this.buildCallerEntry(callNode, sym, relPath, visited);
        if (entry !== undefined) {
          ctx.nodesVisited++;
          results.push(entry);
        }
      }
    } catch {
      /* skip */
    }
    return results;
  }

  private findDirectCallCallers(
    parsed: { root: SgNode },
    sym: string,
    relPath: string,
    visited: Set<string>,
    ctx: {
      nodesVisited: number;
      maxNodes: number;
      truncated: boolean;
      signal: AbortSignal;
    },
  ): Array<{ method: string; file: string; line: number; via: string }> {
    const results: Array<{
      method: string;
      file: string;
      line: number;
      via: string;
    }> = [];
    try {
      const directCallNodes = parsed.root.findAll(`${sym}($$$ARGS)`);

      for (const callNode of directCallNodes) {
        const entry = this.buildCallerEntry(
          callNode,
          sym,
          relPath,
          visited,
          `${sym}(...)`,
        );
        if (entry !== undefined) {
          ctx.nodesVisited++;
          results.push(entry);
        }
      }
    } catch {
      /* skip */
    }
    return results;
  }

  private async findCallersOfFile(
    file: string,
    lang: string | Lang,
    sym: string,
    workspaceRoot: string,
    visited: Set<string>,
    ctx: {
      nodesVisited: number;
      maxNodes: number;
      truncated: boolean;
      signal: AbortSignal;
    },
  ): Promise<
    Array<{ method: string; file: string; line: number; via: string }>
  > {
    if (ctx.signal.aborted || ctx.nodesVisited >= ctx.maxNodes) return [];
    const parsed = await this.parseFile(file, lang);
    if (!parsed) return [];

    const relPath = makeRelative(file, workspaceRoot);
    const memberResults = this.findMemberCallCallers(
      parsed,
      sym,
      relPath,
      visited,
      ctx,
    );
    const directResults = this.findDirectCallCallers(
      parsed,
      sym,
      relPath,
      visited,
      ctx,
    );
    return [...memberResults, ...directResults];
  }

  private async executeCallers(
    symbol: string,
    lang: string | Lang,
    searchPath: string,
    workspaceRoot: string,
    depth: number,
    maxNodes: number,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const visited = new Set<string>();
    let nodesVisited = 0;
    let truncated = false;

    interface CallerEntry {
      method: string;
      file: string;
      line: number;
      via: string;
      callers?: CallerEntry[];
    }

    const findCallersOf = async (
      sym: string,
      currentDepth: number,
    ): Promise<CallerEntry[]> => {
      if (currentDepth <= 0 || nodesVisited >= maxNodes || signal.aborted) {
        if (nodesVisited >= maxNodes) truncated = true;
        return [];
      }

      const callers: CallerEntry[] = [];
      const ctx = { nodesVisited, maxNodes, truncated, signal };
      const syncTraversalState = (): void => {
        nodesVisited = ctx.nodesVisited;
        truncated = ctx.truncated;
      };

      // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      for (const file of files) {
        const fileResults = await this.findCallersOfFile(
          file,
          lang,
          sym,
          workspaceRoot,
          visited,
          ctx,
        );
        for (const r of fileResults) {
          const entry: CallerEntry = {
            method: r.method,
            file: r.file,
            line: r.line,
            via: r.via,
          };
          if (currentDepth > 1 && ctx.nodesVisited < maxNodes) {
            syncTraversalState();
            entry.callers = await findCallersOf(r.method, currentDepth - 1);
            ctx.nodesVisited = nodesVisited;
            ctx.truncated = truncated;
          }
          callers.push(entry);
        }
      }

      nodesVisited = ctx.nodesVisited;
      truncated = ctx.truncated;
      return callers;
    };

    const results = await findCallersOf(symbol, depth);

    return {
      mode: 'callers',
      symbol,
      truncated,
      results,
    };
  }

  // ===== CALLEES =====
  // @plan PLAN-20260211-ASTGREP.P09

  private deduplicateCallRanges(
    callMatches: SgNode[],
  ): Array<{ node: SgNode; start: number; end: number }> {
    const ranges = callMatches.map((c: SgNode) => ({
      node: c,
      start: c.range().start.index,
      end: c.range().end.index,
    }));
    ranges.sort(
      (a: { start: number; end: number }, b: { start: number; end: number }) =>
        a.start - b.start !== 0 ? a.start - b.start : b.end - a.end,
    );

    const outermost: typeof ranges = [];
    for (const r of ranges) {
      const isContained = outermost.some(
        (o: { start: number; end: number }) =>
          r.start >= o.start && r.end <= o.end,
      );
      if (!isContained) outermost.push(r);
    }
    return outermost;
  }

  private async findCalleesOfFile(
    file: string,
    lang: string | Lang,
    sym: string,
    workspaceRoot: string,
    visited: Set<string>,
    ctx: { nodesVisited: number; maxNodes: number },
  ): Promise<
    Array<{ text: string; file: string; line: number; calleeNode?: SgNode }>
  > {
    if (ctx.nodesVisited >= ctx.maxNodes) return [];
    const parsed = await this.parseFile(file, lang);
    if (!parsed) return [];

    const relPath = makeRelative(file, workspaceRoot);
    const results: Array<{
      text: string;
      file: string;
      line: number;
      calleeNode?: SgNode;
    }> = [];

    try {
      const methodMatches = parsed.root.findAll({
        rule: {
          kind: 'method_definition',
          has: {
            kind: 'property_identifier',
            regex: `^${this.escapeRegex(sym)}$`,
          },
        },
      } as NapiConfig);

      for (const methodNode of methodMatches) {
        const callMatches = methodNode.findAll({
          rule: { kind: 'call_expression' },
        } as NapiConfig);
        const outermost = this.deduplicateCallRanges(callMatches);

        for (const { node } of outermost) {
          const callText = node.text().substring(0, 200);
          const key = `${callText}@${relPath}`;
          // eslint-disable-next-line sonarjs/nested-control-flow -- Dedup check inside nested iteration over AST matches
          if (visited.has(key)) continue;
          visited.add(key);
          ctx.nodesVisited++;

          results.push({
            text: callText,
            file: relPath,
            line: node.range().start.line + 1,
            calleeNode: node,
          });
        }
      }
    } catch {
      /* skip */
    }
    return results;
  }

  private async executeCallees(
    symbol: string,
    lang: string | Lang,
    searchPath: string,
    workspaceRoot: string,
    depth: number,
    maxNodes: number,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const visited = new Set<string>();
    let nodesVisited = 0;
    let truncated = false;

    interface CalleeEntry {
      text: string;
      file: string;
      line: number;
      callees?: CalleeEntry[];
    }

    const findCalleesOf = async (
      sym: string,
      currentDepth: number,
    ): Promise<CalleeEntry[]> => {
      if (currentDepth <= 0 || nodesVisited >= maxNodes || signal.aborted) {
        if (nodesVisited >= maxNodes) truncated = true;
        return [];
      }

      const callees: CalleeEntry[] = [];
      const ctx = { nodesVisited, maxNodes };

      for (const file of files) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Signal may be aborted asynchronously between recursive calls while scanning files.
        if (signal.aborted) break;
        const calleeResults = await this.findCalleesOfFile(
          file,
          lang,
          sym,
          workspaceRoot,
          visited,
          ctx,
        );

        for (const r of calleeResults) {
          const entry: CalleeEntry = {
            text: r.text,
            file: r.file,
            line: r.line,
          };
          const calleeName = r.calleeNode
            ? this.extractCalleeName(r.calleeNode)
            : null;
          if (
            currentDepth > 1 &&
            ctx.nodesVisited < maxNodes &&
            calleeName &&
            calleeName !== sym
          ) {
            nodesVisited = ctx.nodesVisited;
            entry.callees = await findCalleesOf(calleeName, currentDepth - 1);
            ctx.nodesVisited = nodesVisited;
          }

          callees.push(entry);
        }
      }

      nodesVisited = ctx.nodesVisited;
      return callees;
    };

    const results = await findCalleesOf(symbol, depth);

    return {
      mode: 'callees',
      symbol,
      truncated,
      results,
    };
  }

  // ===== REFERENCES =====
  // @plan PLAN-20260211-ASTGREP.P10

  private searchDirectCallReferences(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    addResult: (
      category: string,
      file: string,
      line: number,
      text: string,
    ) => void,
  ): void {
    try {
      const memberCalls = parsed.root.findAll(`$OBJ.${symbol}($$$ARGS)`);
      for (const m of memberCalls) {
        addResult('Direct calls', relPath, m.range().start.line + 1, m.text());
      }
    } catch {
      /* skip */
    }

    try {
      const standaloneCalls = parsed.root.findAll(`${symbol}($$$ARGS)`);
      for (const m of standaloneCalls) {
        addResult('Direct calls', relPath, m.range().start.line + 1, m.text());
      }
    } catch {
      /* skip */
    }
  }

  private searchInstantiationReferences(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    addResult: (
      category: string,
      file: string,
      line: number,
      text: string,
    ) => void,
  ): void {
    try {
      const news = parsed.root.findAll(`new ${symbol}($$$ARGS)`);
      for (const m of news) {
        addResult(
          'Instantiations',
          relPath,
          m.range().start.line + 1,
          m.text(),
        );
      }
    } catch {
      /* skip */
    }

    try {
      const lowerSymbol = symbol.charAt(0).toLowerCase() + symbol.slice(1);
      const instanceCalls = parsed.root.findAll({
        rule: {
          kind: 'call_expression',
          has: {
            kind: 'member_expression',
            has: {
              kind: 'identifier',
              regex: `(?i)${this.escapeRegex(lowerSymbol)}|${this.escapeRegex(symbol)}`,
            },
          },
        },
      } as NapiConfig);
      for (const m of instanceCalls) {
        addResult(
          'Instance method calls (heuristic)',
          relPath,
          m.range().start.line + 1,
          m.text(),
        );
      }
    } catch {
      /* skip */
    }
  }

  private searchTypeAndHeritageReferences(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    addResult: (
      category: string,
      file: string,
      line: number,
      text: string,
    ) => void,
  ): void {
    try {
      const typeRefs = parsed.root.findAll({
        rule: {
          kind: 'type_annotation',
          has: {
            kind: 'type_identifier',
            regex: `^${this.escapeRegex(symbol)}$`,
          },
        },
      } as NapiConfig);
      for (const m of typeRefs) {
        addResult(
          'Type annotations',
          relPath,
          m.range().start.line + 1,
          m.text(),
        );
      }
    } catch {
      /* skip */
    }

    try {
      const heritage = parsed.root.findAll(
        `class $NAME extends ${symbol} { $$$BODY }`,
      );
      for (const m of heritage) {
        addResult(
          'Extends/Implements',
          relPath,
          m.range().start.line + 1,
          `class ${m.getMatch('NAME')?.text()} extends ${symbol}`,
        );
      }
    } catch {
      /* skip */
    }

    try {
      const implHeritage = parsed.root.findAll(
        `class $NAME implements ${symbol} { $$$BODY }`,
      );
      for (const m of implHeritage) {
        addResult(
          'Extends/Implements',
          relPath,
          m.range().start.line + 1,
          `class ${m.getMatch('NAME')?.text()} implements ${symbol}`,
        );
      }
    } catch {
      /* skip */
    }
  }

  private searchImportReferences(
    parsed: { root: SgNode },
    symbol: string,
    relPath: string,
    addResult: (
      category: string,
      file: string,
      line: number,
      text: string,
    ) => void,
  ): void {
    try {
      const imports = parsed.root.findAll({
        rule: {
          kind: 'import_specifier',
          has: { kind: 'identifier', regex: `^${this.escapeRegex(symbol)}$` },
        },
      } as NapiConfig);
      for (const m of imports) {
        addResult('Imports', relPath, m.range().start.line + 1, m.text());
      }
    } catch {
      /* skip */
    }
  }

  private async executeReferences(
    symbol: string,
    lang: string | Lang,
    searchPath: string,
    workspaceRoot: string,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const categories: Record<
      string,
      Array<{ file: string; line: number; text: string }>
    > = {
      'Direct calls': [],
      'Instance method calls (heuristic)': [],
      Instantiations: [],
      'Type annotations': [],
      'Extends/Implements': [],
      Imports: [],
    };

    const seen = new Set<string>();
    const addResult = (
      category: string,
      file: string,
      line: number,
      text: string,
    ): void => {
      const key = `${category}:${file}:${line}`;
      if (seen.has(key)) return;
      seen.add(key);
      categories[category].push({ file, line, text: text.substring(0, 200) });
    };

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);
      this.searchDirectCallReferences(parsed, symbol, relPath, addResult);
      this.searchInstantiationReferences(parsed, symbol, relPath, addResult);
      this.searchTypeAndHeritageReferences(parsed, symbol, relPath, addResult);
      this.searchImportReferences(parsed, symbol, relPath, addResult);
    }

    const counts: Record<string, number> = {};
    for (const [cat, items] of Object.entries(categories)) {
      counts[cat] = items.length;
    }

    return {
      mode: 'references',
      symbol,
      truncated: false,
      results: { categories, counts },
    };
  }

  // ===== DEPENDENCIES =====
  // @plan PLAN-20260211-ASTGREP.P10

  private collectNamedAndDefaultImports(
    parsed: { root: SgNode },
    relPath: string,
    imports: Array<{
      file: string;
      line: number;
      source: string;
      kind: string;
    }>,
  ): void {
    try {
      const named = parsed.root.findAll(`import { $$$NAMES } from $SOURCE`);
      for (const m of named) {
        const src = m.getMatch('SOURCE');
        if (src) {
          imports.push({
            file: relPath,
            line: m.range().start.line + 1,
            source: src.text().replace(/['"]/g, ''),
            kind: 'named',
          });
        }
      }
    } catch {
      /* skip */
    }

    try {
      const defaults = parsed.root.findAll(`import $DEFAULT from $SOURCE`);
      for (const m of defaults) {
        const src = m.getMatch('SOURCE');
        if (src) {
          imports.push({
            file: relPath,
            line: m.range().start.line + 1,
            source: src.text().replace(/['"]/g, ''),
            kind: 'default',
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  private collectDynamicAndReexports(
    parsed: { root: SgNode },
    relPath: string,
    imports: Array<{
      file: string;
      line: number;
      source: string;
      kind: string;
    }>,
  ): void {
    try {
      const dynamic = parsed.root.findAll({
        rule: {
          kind: 'call_expression',
          has: { kind: 'import' },
        },
      } as NapiConfig);
      for (const m of dynamic) {
        imports.push({
          file: relPath,
          line: m.range().start.line + 1,
          source: m.text(),
          kind: 'dynamic',
        });
      }
    } catch {
      /* skip */
    }

    try {
      const reexports = parsed.root.findAll({
        rule: {
          kind: 'export_statement',
          has: { kind: 'string', regex: '.' },
        },
      } as NapiConfig);
      for (const m of reexports) {
        if (m.text().includes('from')) {
          imports.push({
            file: relPath,
            line: m.range().start.line + 1,
            source: m.text().substring(0, 200),
            kind: 'reexport',
          });
        }
      }
    } catch {
      /* skip */
    }
  }

  private collectFileImports(
    parsed: { root: SgNode },
    relPath: string,
    imports: Array<{
      file: string;
      line: number;
      source: string;
      kind: string;
    }>,
  ): void {
    this.collectNamedAndDefaultImports(parsed, relPath, imports);
    this.collectDynamicAndReexports(parsed, relPath, imports);
  }

  private async findReverseImports(
    searchPath: string,
    workspaceRoot: string,
    lang: string | Lang,
    signal: AbortSignal,
  ): Promise<
    Array<{ file: string; line: number; source: string; kind: string }>
  > {
    const reverseImports: Array<{
      file: string;
      line: number;
      source: string;
      kind: string;
    }> = [];
    const allFiles = await this.getFiles(workspaceRoot, lang);
    const targetRel = makeRelative(searchPath, workspaceRoot);
    const targetBasename = path.basename(searchPath).replace(/\.\w+$/, '');

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const file of allFiles) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;
      const relPath = makeRelative(file, workspaceRoot);
      if (relPath === targetRel) continue;

      const content = parsed.content || '';
      if (content.includes(targetBasename)) {
        reverseImports.push(
          ...this.collectImportMatches(parsed, relPath, targetBasename),
        );
      }
    }
    return reverseImports;
  }

  private collectImportMatches(
    parsed: { root: SgNode },
    relPath: string,
    targetBasename: string,
  ): Array<{ file: string; line: number; source: string; kind: string }> {
    const imports: Array<{
      file: string;
      line: number;
      source: string;
      kind: string;
    }> = [];
    try {
      const allImports = parsed.root.findAll({
        rule: { kind: 'import_statement' },
      } as NapiConfig);
      for (const m of allImports) {
        const text = m.text();
        if (text.includes(targetBasename)) {
          imports.push({
            file: relPath,
            line: m.range().start.line + 1,
            source: text.substring(0, 200),
            kind: 'import',
          });
        }
      }
    } catch {
      /* skip */
    }
    return imports;
  }

  private async executeDependencies(
    searchPath: string,
    lang: string | Lang,
    workspaceRoot: string,
    reverse: boolean,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const imports: Array<{
      file: string;
      line: number;
      source: string;
      kind: string;
    }> = [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);
      this.collectFileImports(parsed, relPath, imports);
    }

    const reverseImports = reverse
      ? await this.findReverseImports(searchPath, workspaceRoot, lang, signal)
      : [];

    return {
      mode: 'dependencies',
      truncated: false,
      results: {
        imports,
        reverseImports: reverse ? reverseImports : undefined,
      },
    };
  }

  // ===== EXPORTS =====
  // @plan PLAN-20260211-ASTGREP.P10
  private async executeExports(
    searchPath: string,
    lang: string | Lang,
    workspaceRoot: string,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const files = await this.getFiles(searchPath, lang);
    const exports: Array<{
      file: string;
      line: number;
      text: string;
      kind: string;
    }> = [];

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);

      try {
        const exportNodes = parsed.root.findAll({
          rule: { kind: 'export_statement' },
        } as NapiConfig);
        for (const m of exportNodes) {
          const text = m.text();
          let kind = 'export';
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (/^export\s+default\b/.test(text)) kind = 'default';
          else if (text.includes('class')) kind = 'class';
          else if (text.includes('function')) kind = 'function';
          else if (
            text.includes('const') ||
            text.includes('let') ||
            text.includes('var')
          )
            kind = 'const';
          else if (text.includes('interface')) kind = 'interface';
          else if (text.includes('type ')) kind = 'type';
          else if (text.includes('from')) kind = 'reexport';

          exports.push({
            file: relPath,
            line: m.range().start.line + 1,
            text: text.substring(0, 200),
            kind,
          });
        }
      } catch {
        /* skip */
      }
    }

    return {
      mode: 'exports',
      truncated: false,
      results: exports,
    };
  }
}

export class StructuralAnalysisTool extends BaseDeclarativeTool<
  StructuralAnalysisParams,
  ToolResult
> {
  static readonly Name = 'structural_analysis';

  constructor(
    private readonly config: Config,
    _messageBus: MessageBus,
  ) {
    super(
      StructuralAnalysisTool.Name,
      'StructuralAnalysis',
      'Performs multi-hop AST-based code analysis: call graphs, type hierarchies, symbol references, ' +
        'module dependencies, and exports. This is name-based (not type-resolved) analysis. ' +
        'Use for understanding code relationships. Unlike ast_grep (single-query), this chains multiple queries.',
      Kind.Search,
      {
        properties: {
          mode: {
            description: `Analysis mode: ${VALID_MODES.join(', ')}`,
            type: 'string',
            enum: [...VALID_MODES],
          },
          language: {
            description: 'Programming language (e.g., typescript, python)',
            type: 'string',
          },
          path: {
            description: 'Directory to search. Defaults to workspace root.',
            type: 'string',
          },
          symbol: {
            description:
              'Symbol name for callers/callees/definitions/hierarchy/references modes.',
            type: 'string',
          },
          depth: {
            description:
              'Recursion depth for callers/callees. Default 1, max 5.',
            type: 'number',
          },
          maxNodes: {
            description:
              'Max symbols to visit during recursive traversal. Default 50.',
            type: 'number',
          },
          target: {
            description: 'File/directory for dependencies/exports modes.',
            type: 'string',
          },
          reverse: {
            description:
              'For dependencies mode: also find what imports the target.',
            type: 'boolean',
          },
        },
        required: ['mode', 'language'],
        type: 'object',
      },
    );
  }

  protected override createInvocation(
    params: StructuralAnalysisParams,
    messageBus: MessageBus,
  ): ToolInvocation<StructuralAnalysisParams, ToolResult> {
    return new StructuralAnalysisInvocation(this.config, params, messageBus);
  }
}

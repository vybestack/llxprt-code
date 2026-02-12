/**
 * Multi-hop AST-based code analysis tool.
 * Analyzes code relationships: call graphs, type hierarchies, symbol references,
 * module dependencies, and exports using @ast-grep/napi.
 *
 * This is name-based (not type-resolved) analysis. See overview.md for limitations.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

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
import {
  parse,
  Lang,
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
  ) {
    super(params);
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

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { mode, language, symbol, depth, maxNodes, target, reverse } =
      this.params;

    // Validate mode
    if (!VALID_MODES.includes(mode as Mode)) {
      return this.makeError(
        `Error: Invalid mode "${mode}". Valid modes: ${VALID_MODES.join(', ')}`,
      );
    }

    // Validate language
    if (!language) {
      return this.makeError('Error: `language` parameter is required.');
    }
    const resolvedLang = getAstLanguage(language);
    if (!resolvedLang) {
      return this.makeError(
        `Error: Unrecognized language "${language}". Supported: ${Object.keys(LANGUAGE_MAP).join(', ')}`,
      );
    }

    // Resolve search path
    const targetDir = this.config.getTargetDir();
    let searchPath = this.params.path || target || targetDir;
    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(targetDir, searchPath);
    }

    // Workspace boundary (path.sep-aware to prevent sibling bypass)
    const normalizedTarget = targetDir.endsWith(path.sep)
      ? targetDir
      : targetDir + path.sep;
    if (searchPath !== targetDir && !searchPath.startsWith(normalizedTarget)) {
      return this.makeError('Error: Path resolves outside the workspace root.');
    }

    // Symbol required for symbol-scoped modes
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

    const effectiveDepth = Math.min(depth ?? DEFAULT_DEPTH, MAX_DEPTH);
    const effectiveMaxNodes = maxNodes ?? DEFAULT_MAX_NODES;

    try {
      let analysisResult: AnalysisResult;
      switch (mode as Mode) {
        case 'definitions':
          analysisResult = await this.executeDefinitions(
            symbol!,
            resolvedLang,
            searchPath,
            targetDir,
            signal,
          );
          break;
        case 'hierarchy':
          analysisResult = await this.executeHierarchy(
            symbol!,
            resolvedLang,
            searchPath,
            targetDir,
            signal,
          );
          break;
        case 'callers':
          analysisResult = await this.executeCallers(
            symbol!,
            resolvedLang,
            searchPath,
            targetDir,
            effectiveDepth,
            effectiveMaxNodes,
            signal,
          );
          break;
        case 'callees':
          analysisResult = await this.executeCallees(
            symbol!,
            resolvedLang,
            searchPath,
            targetDir,
            effectiveDepth,
            effectiveMaxNodes,
            signal,
          );
          break;
        case 'references':
          analysisResult = await this.executeReferences(
            symbol!,
            resolvedLang,
            searchPath,
            targetDir,
            signal,
          );
          break;
        case 'dependencies':
          analysisResult = await this.executeDependencies(
            searchPath,
            resolvedLang,
            targetDir,
            !!reverse,
            signal,
          );
          break;
        case 'exports':
          analysisResult = await this.executeExports(
            searchPath,
            resolvedLang,
            targetDir,
            signal,
          );
          break;
        default:
          return this.makeError(`Error: Mode "${mode}" is not implemented.`);
      }
      return this.formatResult(analysisResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(`Error in ${mode}: ${msg}`);
    }
  }

  private async getFiles(
    searchPath: string,
    lang: string | Lang,
  ): Promise<string[]> {
    const stat = await fs.stat(searchPath).catch(() => null);
    if (stat?.isFile()) {
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

    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);

      // Search for various definition forms
      const patterns = [
        // Method definitions
        { pat: `${symbol}($$$PARAMS) { $$$BODY }`, kind: 'method' },
        // Function declarations
        { pat: `function ${symbol}($$$PARAMS) { $$$BODY }`, kind: 'function' },
        // Class declarations
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

      // Also search by YAML rule for identifiers in declaration positions
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

    return {
      mode: 'definitions',
      symbol,
      truncated: false,
      results: definitions,
    };
  }

  // ===== HIERARCHY =====
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

    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);

      // Find what the symbol extends/implements
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

      // Find what extends/implements the symbol
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

      for (const file of files) {
        if (signal.aborted || nodesVisited >= maxNodes) break;
        const parsed = await this.parseFile(file, lang);
        if (!parsed) continue;

        const relPath = makeRelative(file, workspaceRoot);

        // Find all member-expression calls to the symbol: $OBJ.sym(...)
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
            if (nodesVisited >= maxNodes) {
              truncated = true;
              break;
            }

            // Walk up to the nearest function-like container
            let container: SgNode | null = callNode.parent();
            while (
              container &&
              !StructuralAnalysisInvocation.FUNCTION_CONTAINER_KINDS.has(
                String(container.kind()),
              )
            ) {
              container = container.parent();
            }
            if (!container) continue;

            const methodName = this.getContainerName(container);
            if (!methodName || methodName === sym) continue;

            const key = `${methodName}@${relPath}`;
            if (visited.has(key)) continue;
            visited.add(key);
            nodesVisited++;

            // Get via context from surrounding statement
            let viaText = '';
            let node: SgNode = callNode;
            let parentNode = node.parent();
            while (parentNode) {
              const parentKind = String(parentNode.kind());
              if (
                parentKind.includes('statement') ||
                StructuralAnalysisInvocation.FUNCTION_CONTAINER_KINDS.has(
                  parentKind,
                )
              ) {
                break;
              }
              node = parentNode;
              parentNode = node.parent();
            }
            viaText = node.text().trim().substring(0, 200);

            const entry: CallerEntry = {
              method: methodName,
              file: relPath,
              line: container.range().start.line + 1,
              via: viaText,
            };

            if (currentDepth > 1 && nodesVisited < maxNodes) {
              entry.callers = await findCallersOf(methodName, currentDepth - 1);
            }

            callers.push(entry);
          }
        } catch {
          /* skip */
        }

        // Also check for direct (non-member) calls: foo() rather than obj.foo()
        try {
          const directCallNodes = parsed.root.findAll(`${sym}($$$ARGS)`);

          for (const callNode of directCallNodes) {
            // Walk up to the nearest function-like container
            let ancestor: SgNode | null = callNode.parent();
            while (
              ancestor &&
              !StructuralAnalysisInvocation.FUNCTION_CONTAINER_KINDS.has(
                String(ancestor.kind()),
              )
            ) {
              ancestor = ancestor.parent();
            }
            if (!ancestor) continue;

            const methodName = this.getContainerName(ancestor);
            if (!methodName || methodName === sym) continue;

            const key = `${methodName}@${relPath}`;
            if (visited.has(key)) continue;
            visited.add(key);
            nodesVisited++;

            callers.push({
              method: methodName,
              file: relPath,
              line: ancestor.range().start.line + 1,
              via: `${sym}(...)`,
            });
          }
        } catch {
          /* skip */
        }
      }

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

      for (const file of files) {
        if (signal.aborted) break;
        const parsed = await this.parseFile(file, lang);
        if (!parsed) continue;

        const relPath = makeRelative(file, workspaceRoot);

        try {
          // Find the method definition
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
            // Find all call expressions inside
            const callMatches = methodNode.findAll({
              rule: { kind: 'call_expression' },
            } as NapiConfig);

            // Byte-range deduplication: keep only outermost calls
            const ranges = callMatches.map((c: SgNode) => ({
              node: c,
              start: c.range().start.index,
              end: c.range().end.index,
            }));
            ranges.sort(
              (
                a: { start: number; end: number },
                b: { start: number; end: number },
              ) => a.start - b.start || b.end - a.end,
            );

            const outermost: typeof ranges = [];
            for (const r of ranges) {
              const isContained = outermost.some(
                (o: { start: number; end: number }) =>
                  r.start >= o.start && r.end <= o.end,
              );
              if (!isContained) outermost.push(r);
            }

            for (const { node } of outermost) {
              const callText = node.text().substring(0, 200);
              const key = `${callText}@${relPath}`;
              if (visited.has(key)) continue;
              visited.add(key);
              nodesVisited++;

              const entry: CalleeEntry = {
                text: callText,
                file: relPath,
                line: node.range().start.line + 1,
              };

              // Recurse for depth > 1: extract callee name and follow it
              if (currentDepth > 1 && nodesVisited < maxNodes) {
                const calleeName = this.extractCalleeName(node);
                if (calleeName && calleeName !== sym) {
                  entry.callees = await findCalleesOf(
                    calleeName,
                    currentDepth - 1,
                  );
                }
              }

              callees.push(entry);
            }
          }
        } catch {
          /* skip */
        }
      }

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

    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);

      // Member calls: obj.symbol()
      try {
        const memberCalls = parsed.root.findAll(`$OBJ.${symbol}($$$ARGS)`);
        for (const m of memberCalls) {
          addResult(
            'Direct calls',
            relPath,
            m.range().start.line + 1,
            m.text(),
          );
        }
      } catch {
        /* skip */
      }

      // Standalone calls: symbol()
      try {
        const standaloneCalls = parsed.root.findAll(`${symbol}($$$ARGS)`);
        for (const m of standaloneCalls) {
          addResult(
            'Direct calls',
            relPath,
            m.range().start.line + 1,
            m.text(),
          );
        }
      } catch {
        /* skip */
      }

      // Instantiations: new Symbol(...)
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

      // Instance method calls (heuristic): calls on variables named like the symbol
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

      // Type annotations
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

      // Extends/Implements
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

      // Imports
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

    // Build counts
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

    for (const file of files) {
      if (signal.aborted) break;
      const parsed = await this.parseFile(file, lang);
      if (!parsed) continue;

      const relPath = makeRelative(file, workspaceRoot);

      // Named imports: import { X } from 'Y'
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

      // Default imports: import X from 'Y'
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

      // Dynamic imports: import('X')
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

      // Re-exports: export { X } from 'Y'
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

    const reverseImports: typeof imports = [];
    if (reverse) {
      // Find files that import the target
      const allFiles = await this.getFiles(workspaceRoot, lang);
      const targetRel = makeRelative(searchPath, workspaceRoot);
      for (const file of allFiles) {
        if (signal.aborted) break;
        const parsed = await this.parseFile(file, lang);
        if (!parsed) continue;
        const relPath = makeRelative(file, workspaceRoot);
        if (relPath === targetRel) continue;

        const content = parsed.content || '';
        if (content.includes(path.basename(searchPath).replace(/\.\w+$/, ''))) {
          try {
            const allImports = parsed.root.findAll({
              rule: { kind: 'import_statement' },
            } as NapiConfig);
            for (const m of allImports) {
              const text = m.text();
              if (
                text.includes(path.basename(searchPath).replace(/\.\w+$/, ''))
              ) {
                reverseImports.push({
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
        }
      }
    }

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
    _messageBus?: MessageBus,
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
    _messageBus?: MessageBus,
  ): ToolInvocation<StructuralAnalysisParams, ToolResult> {
    return new StructuralAnalysisInvocation(this.config, params);
  }
}

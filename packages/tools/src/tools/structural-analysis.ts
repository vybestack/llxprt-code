/**
 * Multi-hop AST-based code analysis tool.
 * Analyzes code relationships: call graphs, type hierarchies, symbol references,
 * module dependencies, and exports using @ast-grep/napi.
 *
 * This is name-based (not type-resolved) analysis. See overview.md for limitations.
 *
 * The analysis logic is decomposed into per-mode sub-modules under
 * `./structural-analysis/`. This file is the public facade that wires the
 * `StructuralAnalysisTool` declaration and its invocation, delegating execution
 * to the sub-modules.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import * as path from 'node:path';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { getAstLanguage, LANGUAGE_MAP } from '../utils/ast-grep-utils.js';
import type { IToolHost, IToolMessageBus } from '../interfaces/index.js';
import {
  VALID_MODES,
  type Mode,
  DEFAULT_DEPTH,
  MAX_DEPTH,
  DEFAULT_MAX_NODES,
  type StructuralAnalysisParams,
  type AnalysisResult,
  type ResolvedLang,
} from './structural-analysis/types.js';
import { executeDefinitions } from './structural-analysis/definitions.js';
import { executeHierarchy } from './structural-analysis/hierarchy.js';
import { executeCallers } from './structural-analysis/callers.js';
import { executeCallees } from './structural-analysis/callees.js';
import { executeReferences } from './structural-analysis/references.js';
import { executeDependencies } from './structural-analysis/dependencies.js';
import { executeExports } from './structural-analysis/exports.js';

export type { StructuralAnalysisParams } from './structural-analysis/types.js';

interface ResolvedParams {
  mode: string;
  resolvedLang: ResolvedLang;
  searchPath: string;
  targetDir: string;
  symbol: string | undefined;
  depth: number;
  maxNodes: number;
  reverse: boolean;
}

class StructuralAnalysisInvocation extends BaseToolInvocation<
  StructuralAnalysisParams,
  ToolResult
> {
  constructor(
    private readonly host: IToolHost,
    params: StructuralAnalysisParams,
    messageBus: IToolMessageBus,
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

  private validateAndResolveParams(): ResolvedParams | ToolResult {
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

    const targetDir = this.host.getTargetDir();
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
    params: ResolvedParams,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const {
      mode,
      resolvedLang,
      searchPath,
      targetDir,
      symbol,
      depth,
      maxNodes,
      reverse,
    } = params;

    switch (mode as Mode) {
      case 'definitions':
        return executeDefinitions(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          signal,
        );
      case 'hierarchy':
        return executeHierarchy(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          signal,
        );
      case 'callers':
        return executeCallers(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          depth,
          maxNodes,
          signal,
        );
      case 'callees':
        return executeCallees(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          depth,
          maxNodes,
          signal,
        );
      case 'references':
        return executeReferences(
          symbol!,
          resolvedLang,
          searchPath,
          targetDir,
          signal,
        );
      case 'dependencies':
        return executeDependencies(
          searchPath,
          resolvedLang,
          targetDir,
          reverse,
          signal,
        );
      case 'exports':
        return executeExports(searchPath, resolvedLang, targetDir, signal);
      default:
        throw new Error(`Mode "${mode}" is not implemented.`);
    }
  }

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const params = this.validateAndResolveParams();
    if ('llmContent' in params) return params;

    try {
      const analysisResult = await this.dispatchMode(params, signal);
      return this.formatResult(analysisResult);
    } catch (err) {
      if (err instanceof Error && err.message.endsWith('is not implemented.')) {
        return this.makeError(`Error: ${err.message}`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      return this.makeError(`Error in ${params.mode}: ${msg}`);
    }
  }
}

export class StructuralAnalysisTool extends BaseDeclarativeTool<
  StructuralAnalysisParams,
  ToolResult
> {
  static readonly Name = 'structural_analysis';

  constructor(private readonly host: IToolHost) {
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
    messageBus: IToolMessageBus,
  ): ToolInvocation<StructuralAnalysisParams, ToolResult> {
    return new StructuralAnalysisInvocation(this.host, params, messageBus);
  }
}

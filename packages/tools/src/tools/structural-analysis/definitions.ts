/**
 * Definitions analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import type { NapiConfig, SgNode } from '@ast-grep/napi';
import type {
  ParsedFile,
  AnalysisResult,
  DefinitionEntry,
  ResolvedLang,
} from './types.js';
import {
  escapeRegex,
  iterateFiles,
  parseFile,
  makeRelative,
} from './helpers.js';
import { type AnalysisBudget, BudgetTracker } from './budget.js';

/** Stable dedup key for a definition entry: file path + line number. */
function definitionKey(file: string, line: number): string {
  return `${file}:${line}`;
}

function searchFunctionAndMethodDefinitions(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  definitions: DefinitionEntry[],
  seenKeys: Set<string>,
): void {
  const escaped = escapeRegex(symbol);
  const rules: Array<{ kind: string; kindLabel: string; nameKind: string }> = [
    {
      kind: 'function_declaration',
      kindLabel: 'function',
      nameKind: 'identifier',
    },
    {
      kind: 'generator_function_declaration',
      kindLabel: 'function',
      nameKind: 'identifier',
    },
    {
      kind: 'method_definition',
      kindLabel: 'method',
      nameKind: 'property_identifier',
    },
  ];

  for (const { kind, kindLabel, nameKind } of rules) {
    collectRuleDefinitions(
      parsed,
      { kind, nameKind, regex: `^${escaped}$` },
      kindLabel,
      relPath,
      definitions,
      seenKeys,
    );
  }

  collectVariableBoundFunctionDefinitions(
    parsed,
    escaped,
    relPath,
    definitions,
    seenKeys,
  );
}

/**
 * Kinds that, when they appear as a direct child of a variable_declarator,
 * mean the declarator binds a function-like expression.
 */
const VARIABLE_BOUND_FUNCTION_KINDS = [
  'arrow_function',
  'function_expression',
  'generator_function',
] as const;

/**
 * Finds variable_declarator nodes that bind a function-like expression
 * (arrow_function, function_expression, or generator_function) whose
 * identifier matches `escapedSymbol`, and reports them with kind 'function'.
 *
 * Only DIRECT children are inspected — the function node is always a direct
 * child of the declarator, even for type-annotated bindings (e.g.
 * `const f: () => void = () => {}`); a descendant search would wrongly match
 * functions nested inside the initialiser.
 */
function collectVariableBoundFunctionDefinitions(
  parsed: ParsedFile,
  escapedSymbol: string,
  relPath: string,
  definitions: DefinitionEntry[],
  seenKeys: Set<string>,
): void {
  try {
    const declarators = parsed.root.findAll({
      rule: {
        kind: 'variable_declarator',
        has: { kind: 'identifier', regex: `^${escapedSymbol}$` },
      },
    } as NapiConfig);
    for (const d of declarators) {
      const fn = d
        .children()
        .find((c: SgNode) =>
          (VARIABLE_BOUND_FUNCTION_KINDS as readonly string[]).includes(
            String(c.kind()),
          ),
        );
      if (fn === undefined) continue;
      const line = d.range().start.line + 1;
      const key = definitionKey(relPath, line);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        definitions.push({
          file: relPath,
          line,
          kind: 'function',
          text: d.text().substring(0, 200),
        });
      }
    }
  } catch {
    // Rule names TS node kinds; ast-grep throws for languages whose grammar lacks them.
  }
}

/**
 * Runs a single AST kind + name rule and appends deduplicated definition
 * entries. Isolated so the caller stays below the nesting limit.
 */
function collectRuleDefinitions(
  parsed: ParsedFile,
  rule: { kind: string; nameKind: string; regex: string },
  kindLabel: string,
  relPath: string,
  definitions: DefinitionEntry[],
  seenKeys: Set<string>,
): void {
  let matches: SgNode[];
  try {
    matches = parsed.root.findAll({
      rule: {
        kind: rule.kind,
        has: { kind: rule.nameKind, regex: rule.regex },
      },
    } as NapiConfig);
  } catch {
    // Rule names TS node kinds; ast-grep throws for languages whose grammar lacks them.
    return;
  }
  for (const m of matches) {
    const line = m.range().start.line + 1;
    const key = definitionKey(relPath, line);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      definitions.push({
        file: relPath,
        line,
        kind: kindLabel,
        text: m.text().substring(0, 200),
      });
    }
  }
}

/**
 * Maps raw ast-grep declaration node kinds to the friendly labels used by the
 * function/method path, so callers see 'class' not 'class_declaration'.
 */
const DECLARATION_KIND_LABELS: Record<string, string> = {
  class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
};

function searchDeclarationRules(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  definitions: DefinitionEntry[],
  seenKeys: Set<string>,
): void {
  try {
    const ruleMatches = parsed.root.findAll({
      rule: {
        any: [
          {
            kind: 'class_declaration',
            has: {
              kind: 'type_identifier',
              regex: `^${escapeRegex(symbol)}$`,
            },
          },
          {
            kind: 'interface_declaration',
            has: {
              kind: 'type_identifier',
              regex: `^${escapeRegex(symbol)}$`,
            },
          },
          {
            kind: 'type_alias_declaration',
            has: {
              kind: 'type_identifier',
              regex: `^${escapeRegex(symbol)}$`,
            },
          },
        ],
      },
    } as NapiConfig);
    for (const m of ruleMatches) {
      const range = m.range();
      const line = range.start.line + 1;
      const key = definitionKey(relPath, line);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        const rawKind = String(m.kind());
        definitions.push({
          file: relPath,
          line,
          kind: DECLARATION_KIND_LABELS[rawKind] ?? rawKind,
          text: m.text().substring(0, 200),
        });
      }
    }
  } catch {
    // Rule names TS node kinds; ast-grep throws for languages whose grammar lacks them.
  }
}

/**
 * Processes a single file for definitions, retaining matches through the
 * budget tracker. Returns false to stop the file loop (budget exhausted or
 * record-budget sentinel fired).
 */
async function processDefinitionsFile(
  file: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  symbol: string,
  definitions: DefinitionEntry[],
  globalSeenKeys: Set<string>,
  tracker: BudgetTracker,
): Promise<boolean> {
  if (!tracker.shouldVisitMoreFiles()) return false;
  tracker.filesVisited++;
  const outcome = await parseFile(file, lang);
  if (!outcome.ok) {
    tracker.recordFileOmission(outcome.reason);
    return true;
  }

  const relPath = makeRelative(file, workspaceRoot);
  const pending: DefinitionEntry[] = [];
  const fileSeenKeys = new Set<string>();
  searchFunctionAndMethodDefinitions(
    outcome,
    symbol,
    relPath,
    pending,
    fileSeenKeys,
  );
  searchDeclarationRules(outcome, symbol, relPath, pending, fileSeenKeys);

  for (const def of pending) {
    const key = definitionKey(def.file, def.line);
    if (globalSeenKeys.has(key)) continue;
    if (!tracker.tryRetainRecord()) return false;
    globalSeenKeys.add(key);
    definitions.push(def);
  }
  return true;
}

export async function executeDefinitions(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  signal: AbortSignal,
  budget: AnalysisBudget,
): Promise<AnalysisResult> {
  const tracker = new BudgetTracker(budget, signal);
  const definitions: DefinitionEntry[] = [];
  const globalSeenKeys = new Set<string>();

  for await (const file of iterateFiles(searchPath, lang, signal)) {
    if (
      !(await processDefinitionsFile(
        file,
        lang,
        workspaceRoot,
        symbol,
        definitions,
        globalSeenKeys,
        tracker,
      ))
    )
      break;
  }

  if (signal.aborted) {
    tracker.markAborted();
  }

  return {
    mode: 'definitions',
    symbol,
    truncated: tracker.truncated,
    partial: tracker.truncated,
    partialReason: tracker.partialReason,
    fileBudget: budget.fileBudget,
    recordBudget: budget.recordBudget,
    filesVisited: tracker.filesVisited,
    recordsRetained: tracker.recordsRetained,
    recordsObserved: tracker.recordsObserved,
    oversizedFiles: tracker.oversizedFiles,
    unparseableFiles: tracker.unparseableFiles,
    countInexact: tracker.countInexact,
    results: definitions,
  };
}

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
import { escapeRegex, getFiles, parseFile, makeRelative } from './helpers.js';

function searchFunctionAndMethodDefinitions(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  definitions: DefinitionEntry[],
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
    );
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
    return;
  }
  for (const m of matches) {
    const line = m.range().start.line + 1;
    const exists = definitions.some(
      (d) => d.file === relPath && d.line === line,
    );
    if (!exists) {
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
      const exists = definitions.some(
        (d) => d.file === relPath && d.line === range.start.line + 1,
      );
      if (!exists) {
        const rawKind = String(m.kind());
        definitions.push({
          file: relPath,
          line: range.start.line + 1,
          kind: DECLARATION_KIND_LABELS[rawKind] ?? rawKind,
          text: m.text().substring(0, 200),
        });
      }
    }
  } catch {
    // Rule may not apply
  }
}

/**
 * Processes a single file for definitions, unless the signal is aborted.
 */
async function processDefinitionsFile(
  file: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  symbol: string,
  definitions: DefinitionEntry[],
): Promise<boolean> {
  const parsed = await parseFile(file, lang);
  if (!parsed) {
    return true;
  }

  const relPath = makeRelative(file, workspaceRoot);
  searchFunctionAndMethodDefinitions(parsed, symbol, relPath, definitions);
  searchDeclarationRules(parsed, symbol, relPath, definitions);
  return true;
}

export async function executeDefinitions(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const definitions: DefinitionEntry[] = [];

  for (const file of files) {
    if (signal.aborted) {
      break;
    }
    await processDefinitionsFile(
      file,
      lang,
      workspaceRoot,
      symbol,
      definitions,
    );
  }

  return {
    mode: 'definitions',
    symbol,
    truncated: false,
    results: definitions,
  };
}

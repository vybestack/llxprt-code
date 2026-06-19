/**
 * Definitions analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import type { NapiConfig } from '@ast-grep/napi';
import type {
  ParsedFile,
  AnalysisResult,
  DefinitionEntry,
  ResolvedLang,
} from './types.js';
import { escapeRegex, getFiles, parseFile, makeRelative } from './helpers.js';

function searchDefinitionPatterns(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  definitions: DefinitionEntry[],
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
  searchDefinitionPatterns(parsed, symbol, relPath, definitions);
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

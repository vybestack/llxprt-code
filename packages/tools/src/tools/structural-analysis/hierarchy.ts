/**
 * Type hierarchy analysis mode for the structural-analysis tool.
 *
 * @plan PLAN-20260211-ASTGREP.P07
 */

import type { ParsedFile, AnalysisResult, ResolvedLang } from './types.js';
import { getFiles, parseFile, makeRelative } from './helpers.js';

interface HierarchyNode {
  name: string;
  file: string;
  line: number;
}

function findSymbolParents(
  parsed: ParsedFile,
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

function findSymbolChildren(
  parsed: ParsedFile,
  symbol: string,
  relPath: string,
  extendedBy: HierarchyNode[],
  implementedBy: HierarchyNode[],
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

/**
 * Processes a single file for hierarchy relationships, unless aborted.
 */
async function processHierarchyFile(
  file: string,
  lang: ResolvedLang,
  workspaceRoot: string,
  symbol: string,
  extendsParent: string[],
  implementsInterfaces: string[],
  extendedBy: HierarchyNode[],
  implementedBy: HierarchyNode[],
): Promise<void> {
  const parsed = await parseFile(file, lang);
  if (!parsed) {
    return;
  }

  const relPath = makeRelative(file, workspaceRoot);
  findSymbolParents(parsed, symbol, extendsParent, implementsInterfaces);
  findSymbolChildren(parsed, symbol, relPath, extendedBy, implementedBy);
}

export async function executeHierarchy(
  symbol: string,
  lang: ResolvedLang,
  searchPath: string,
  workspaceRoot: string,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const files = await getFiles(searchPath, lang);
  const extendsParent: string[] = [];
  const implementsInterfaces: string[] = [];
  const extendedBy: HierarchyNode[] = [];
  const implementedBy: HierarchyNode[] = [];

  for (const file of files) {
    if (signal.aborted) {
      break;
    }
    await processHierarchyFile(
      file,
      lang,
      workspaceRoot,
      symbol,
      extendsParent,
      implementsInterfaces,
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

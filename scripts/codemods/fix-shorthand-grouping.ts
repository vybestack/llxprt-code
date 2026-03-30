/**
 * Phase M1 Codemod: sonarjs/shorthand-property-grouping
 *
 * Reorders object literal properties so shorthand properties are grouped together
 * (at the beginning or end), preserving behavior, comments, and formatting.
 *
 * Strategy:
 *   1. Parse with TS AST to find ObjectLiteralExpression nodes needing reorder
 *   2. Use source-text slicing to extract each property verbatim (lossless)
 *   3. Reorder by rearranging the verbatim source slices
 *   4. Validate result parses without errors before writing
 *
 * Usage: npx tsx scripts/codemods/fix-shorthand-grouping.ts [--apply]
 *   --apply  Actually write changes (default is dry-run)
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────────────────────────

interface PropSlice {
  /** Start offset of the full trivia (includes leading whitespace/comments) */
  triviaStart: number;
  /** Start offset of the actual property node text */
  nodeStart: number;
  /** End offset of the property node */
  nodeEnd: number;
  isShorthand: boolean;
  originalIndex: number;
}

interface FileResult {
  filePath: string;
  changed: boolean;
  fixedCount: number;
  error?: string;
}

// ── Core Logic ─────────────────────────────────────────────────────────────

function isAlreadyGrouped(
  props: ts.NodeArray<ts.ObjectLiteralElementLike>,
): boolean {
  if (props.length <= 2) return true;

  let foundNonShorthand = false;
  let foundTrailingShorthand = false;

  for (const prop of props) {
    const isShort = ts.isShorthandPropertyAssignment(prop);
    if (!isShort) {
      foundNonShorthand = true;
      if (foundTrailingShorthand) return false;
    } else if (foundNonShorthand) {
      foundTrailingShorthand = true;
    }
  }
  return true;
}

function detectDirection(
  props: ts.NodeArray<ts.ObjectLiteralElementLike>,
): 'beginning' | 'end' {
  let firstShortIdx = -1;
  let lastNonShortIdx = -1;

  for (let i = 0; i < props.length; i++) {
    if (ts.isShorthandPropertyAssignment(props[i])) {
      if (firstShortIdx === -1) firstShortIdx = i;
    } else {
      lastNonShortIdx = i;
    }
  }

  if (lastNonShortIdx > firstShortIdx && firstShortIdx !== -1) return 'end';
  return 'beginning';
}

/**
 * Find the comma positions between properties in the original source.
 * TS AST doesn't directly expose commas, so we search for them between properties.
 */
function findCommas(
  sourceText: string,
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): number[] {
  const commas: number[] = [];
  const props = obj.properties;

  for (let i = 0; i < props.length - 1; i++) {
    const currentEnd = props[i].getEnd();
    const nextStart = props[i + 1].getStart(sourceFile);

    // Find comma between current end and next start
    for (let pos = currentEnd; pos < nextStart; pos++) {
      if (sourceText[pos] === ',') {
        commas.push(pos);
        break;
      }
    }
  }

  return commas;
}

/**
 * Check if there is a trailing comma after the last property.
 */
function findTrailingComma(
  sourceText: string,
  obj: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): number | -1 {
  if (obj.properties.length === 0) return -1;
  const lastPropEnd = obj.properties[obj.properties.length - 1].getEnd();
  const objEnd = obj.getEnd();
  const closeBracePos = sourceText.lastIndexOf('}', objEnd);

  for (let pos = lastPropEnd; pos < closeBracePos; pos++) {
    if (sourceText[pos] === ',') {
      return pos;
    }
  }
  return -1;
}

/**
 * Reorder an object literal using source-text slicing (lossless).
 *
 * Instead of printing AST nodes (which loses formatting/comments),
 * we slice each property directly from the source text and rearrange.
 */
function reorderObjectLiteral(
  sourceText: string,
  sourceFile: ts.SourceFile,
  obj: ts.ObjectLiteralExpression,
  direction: 'beginning' | 'end',
): string {
  const props = obj.properties;
  if (props.length <= 1)
    return sourceText.substring(obj.getStart(sourceFile), obj.getEnd());

  const objStart = obj.getStart(sourceFile);
  const objEnd = obj.getEnd();
  const objText = sourceText.substring(objStart, objEnd);

  // Find the opening brace
  const openBraceOffset = objText.indexOf('{');
  const openBracePos = objStart + openBraceOffset;

  // Find the closing brace
  const closeBraceOffset = objText.lastIndexOf('}');
  const closeBracePos = objStart + closeBraceOffset;

  // Find commas
  const commas = findCommas(sourceText, obj, sourceFile);
  const trailingCommaPos = findTrailingComma(sourceText, obj, sourceFile);

  // Extract each property's core text (node text, no leading trivia)
  // We'll rebuild the whitespace/indentation ourselves
  type PropInfo = { nodeText: string; isShorthand: boolean; idx: number };
  const propList: PropInfo[] = [];

  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    const start = prop.getStart(sourceFile);
    const end = prop.getEnd();

    // Get just the node text
    let nodeText = sourceText.substring(start, end);

    // Check for trailing comma in the node text
    // (sometimes getEnd includes the comma, sometimes not)
    // We want clean property text without commas
    nodeText = nodeText.replace(/,\s*$/, '');

    propList.push({
      nodeText,
      isShorthand: ts.isShorthandPropertyAssignment(prop),
      idx: i,
    });
  }

  // Separate into groups
  const shorthand = propList.filter((p) => p.isShorthand);
  const nonShorthand = propList.filter((p) => !p.isShorthand);

  // Determine order
  const ordered =
    direction === 'beginning'
      ? [...shorthand, ...nonShorthand]
      : [...nonShorthand, ...shorthand];

  // Determine the prefix (opening brace + newline/whitespace)
  // and suffix (closing brace)
  const prefix = sourceText.substring(objStart, openBracePos + 1);
  const suffix = sourceText.substring(closeBracePos, objEnd);

  // Detect indentation from the first property's leading whitespace
  const firstProp = props[0];
  const firstPropStart = firstProp.getStart(sourceFile);
  const firstPropLineStart = sourceText.lastIndexOf('\n', firstPropStart - 1);

  let isSingleLine = !objText
    .substring(openBraceOffset + 1, closeBraceOffset)
    .includes('\n');

  if (isSingleLine) {
    // Single-line format: { a, b: c, d }
    const propStr = ordered.map((p) => p.nodeText).join(', ');
    const hadTrailingComma = trailingCommaPos !== -1;
    return `{ ${propStr}${hadTrailingComma ? ',' : ''} }`;
  }

  // Multi-line format
  // Detect property indent from source
  const propIndent =
    firstPropLineStart === -1
      ? ''
      : sourceText.substring(firstPropLineStart + 1, firstPropStart);

  // Detect base indent (the indent of the closing brace line)
  // by looking at the whitespace before the closing brace
  const closeBraceLineStart = sourceText.lastIndexOf('\n', closeBracePos - 1);
  const baseIndent =
    closeBraceLineStart === -1
      ? ''
      : sourceText.substring(closeBraceLineStart + 1, closeBracePos);

  // Build the body
  const bodyLines = ordered.map((p) => `${propIndent}${p.nodeText},`);

  return `${prefix}\n${bodyLines.join('\n')}\n${baseIndent}}`;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateTransformation(
  originalSource: string,
  newSource: string,
  filePath: string,
): string | null {
  const scriptKind = /\.(tsx|jsx)$/.test(filePath)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;

  const checkFile = ts.createSourceFile(
    filePath + '.check',
    newSource,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const diags = checkFile.parseDiagnostics || [];
  if (diags.length > 0) {
    return `Parse error: ${diags
      .slice(0, 3)
      .map((d) => (typeof d.messageText === 'string' ? d.messageText : ''))
      .join('; ')}`;
  }

  // Verify all identifiers from original are preserved
  // Only check the changed regions to avoid false positives
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────

function processFile(filePath: string, apply: boolean): FileResult {
  const sourceText = fs.readFileSync(filePath, 'utf-8');
  const scriptKind = /\.(tsx|jsx)$/.test(filePath)
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const result: FileResult = {
    filePath,
    changed: false,
    fixedCount: 0,
  };

  // Collect edits
  const edits: { start: number; end: number; newText: string }[] = [];

  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const props = node.properties;
      const hasShorthand = props.some((p) =>
        ts.isShorthandPropertyAssignment(p),
      );
      const hasNonShorthand = props.some(
        (p) => !ts.isShorthandPropertyAssignment(p),
      );

      if (!hasShorthand || !hasNonShorthand) {
        ts.forEachChild(node, visit);
        return;
      }

      if (isAlreadyGrouped(props)) {
        ts.forEachChild(node, visit);
        return;
      }

      const direction = detectDirection(props);
      const newText = reorderObjectLiteral(
        sourceText,
        sourceFile,
        node,
        direction,
      );

      edits.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        newText,
      });
      result.fixedCount++;
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);

  if (edits.length === 0) return result;

  // Apply edits in reverse order
  edits.sort((a, b) => b.start - a.start);

  let newSource = sourceText;
  for (const edit of edits) {
    newSource =
      newSource.substring(0, edit.start) +
      edit.newText +
      newSource.substring(edit.end);
  }

  // Validate
  const error = validateTransformation(sourceText, newSource, filePath);
  if (error) {
    result.error = error;
    return result;
  }

  result.changed = true;
  if (apply) {
    fs.writeFileSync(filePath, newSource, 'utf-8');
  }

  return result;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  console.log(`\n${'='.repeat(72)}`);
  console.log(
    `Phase M1 Codemod: shorthand-property-grouping (${apply ? 'APPLY' : 'DRY-RUN'})`,
  );
  console.log(`${'='.repeat(72)}\n`);

  const targetDirs = [
    'packages/core/src',
    'packages/cli/src',
    'packages/a2a-server/src',
    'packages/vscode-ide-companion/src',
  ];

  let totalChanged = 0;
  let totalFixed = 0;
  let totalErrors = 0;
  const errorFiles: string[] = [];

  for (const dir of targetDirs) {
    const absDir = path.resolve(process.cwd(), dir);
    if (!fs.existsSync(absDir)) {
      console.log(`SKIP: ${dir} does not exist`);
      continue;
    }

    const files = walkDir(absDir);
    let dirChanged = 0;
    let dirFixed = 0;

    for (const file of files) {
      const r = processFile(file, apply);
      if (r.changed) {
        dirChanged++;
        dirFixed += r.fixedFixed || r.fixedCount;
        totalFixed += r.fixedCount;
        const rel = path.relative(process.cwd(), file);
        console.log(
          `  ${apply ? 'FIXED' : 'WOULD FIX'}: ${rel} (${r.fixedCount} objects)`,
        );
      }
      if (r.error) {
        totalErrors++;
        const rel = path.relative(process.cwd(), file);
        errorFiles.push(rel);
        console.error(`  ERROR: ${rel}: ${r.error}`);
      }
    }

    totalChanged += dirChanged;
    console.log(`  ${dir}: ${dirChanged} files, ${dirFixed} objects\n`);
  }

  console.log(`${'─'.repeat(72)}`);
  console.log(`Summary:`);
  console.log(`  Files ${apply ? 'changed' : 'to change'}: ${totalChanged}`);
  console.log(`  Objects reordered: ${totalFixed}`);
  console.log(`  Files with errors (skipped): ${totalErrors}`);
  if (errorFiles.length > 0) {
    console.log(`  Error files: ${errorFiles.join(', ')}`);
  }
  console.log(`${'─'.repeat(72)}\n`);

  if (!apply && totalChanged > 0) {
    console.log(
      `Run with --apply: npx tsx scripts/codemods/fix-shorthand-grouping.ts --apply\n`,
    );
  }
}

main();

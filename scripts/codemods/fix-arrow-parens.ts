/**
 * Codemod: fix sonarjs/arrow-function-convention
 *
 * Removes unnecessary parentheses from single-parameter arrow functions
 * where the parameter is a simple identifier (no type annotation, no
 * destructuring, no default value, no rest param).
 *
 * Usage: npx tsx scripts/codemods/fix-arrow-parens.ts "packages/core/src/**\/*.ts"
 */

import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

interface Replacement {
  start: number;
  end: number;
  text: string;
}

function processFile(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const replacements: Replacement[] = [];

  function visit(node: ts.Node) {
    if (ts.isArrowFunction(node)) {
      // Only handle single-parameter arrow functions
      if (node.parameters.length === 1) {
        const param = node.parameters[0];

        // Skip if parameter has:
        // - type annotation: (x: string) => ...
        // - initializer/default: (x = 5) => ...
        // - rest: (...args) => ...
        // - destructuring: ({a, b}) or ([a, b])
        // - decorators
        if (
          param.type != null ||
          param.initializer != null ||
          param.dotDotDotToken != null ||
          !ts.isIdentifier(param.name) ||
          (param.modifiers != null && param.modifiers.length > 0) ||
          node.type != null // arrow function has return type annotation: (d): d is Foo =>
        ) {
          ts.forEachChild(node, visit);
          return;
        }

        // Check if the parameter is already unparenthesized
        // A parenthesized param list has '(' before first param
        const paramStart = param.getStart(sourceFile);
        const paramEnd = param.getEnd();

        // Find the opening paren before the parameter
        let searchStart = node.getStart(sourceFile);
        // Skip async keyword if present
        const nodeText = node.getText(sourceFile);
        if (nodeText.startsWith('async')) {
          searchStart += 5; // skip 'async'
        }

        const textBeforeParam = content.substring(searchStart, paramStart);
        const openParenIdx = textBeforeParam.lastIndexOf('(');
        if (openParenIdx === -1) {
          // Already no parens
          ts.forEachChild(node, visit);
          return;
        }

        const absOpenParen = searchStart + openParenIdx;

        // Find the closing paren after the parameter
        const textAfterParam = content.substring(paramEnd);
        const closeParenIdx = textAfterParam.indexOf(')');
        if (closeParenIdx === -1) {
          ts.forEachChild(node, visit);
          return;
        }

        const absCloseParen = paramEnd + closeParenIdx;

        // Verify there's nothing between the parens except the parameter name and whitespace
        const betweenOpen = content
          .substring(absOpenParen + 1, paramStart)
          .trim();
        const betweenClose = content.substring(paramEnd, absCloseParen).trim();
        if (betweenOpen !== '' || betweenClose !== '') {
          // There's something else (like a comma for trailing comma, or other content)
          ts.forEachChild(node, visit);
          return;
        }

        // Replace "(param)" with "param"
        const paramName = param.name.text;
        replacements.push({
          start: absOpenParen,
          end: absCloseParen + 1,
          text: paramName,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);

  if (replacements.length === 0) return 0;

  // Apply replacements in reverse order
  replacements.sort((a, b) => b.start - a.start);
  let result = content;
  for (const r of replacements) {
    result = result.substring(0, r.start) + r.text + result.substring(r.end);
  }

  fs.writeFileSync(filePath, result, 'utf-8');
  return replacements.length;
}

async function main() {
  const pattern = process.argv[2];
  if (!pattern) {
    console.error(
      'Usage: npx tsx scripts/codemods/fix-arrow-parens.ts "glob-pattern"',
    );
    process.exit(1);
  }

  const files = await glob(pattern, { absolute: true });
  let totalFixes = 0;
  let totalFiles = 0;

  for (const file of files.sort()) {
    const fixes = processFile(file);
    if (fixes > 0) {
      console.log(`${path.relative(process.cwd(), file)}: ${fixes} fixes`);
      totalFixes += fixes;
      totalFiles++;
    }
  }

  console.log(`\nDone: ${totalFixes} fixes across ${totalFiles} files`);
}

main().catch(console.error);

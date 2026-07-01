#!/usr/bin/env node
/**
 * Codemod: convert narrowing `if (cond) { expect(...) ... }` patterns into
 * `if (!cond) throw new Error('...'); expect(...) ...` so that the expect
 * calls run unconditionally and satisfy vitest/no-conditional-expect.
 *
 * Scope: only rewrites IfStatements that
 *   - have no `else` clause,
 *   - have a block body,
 *   - contain at least one `expect(` CallExpression somewhere in the body,
 *   - and where the test expression is one of:
 *       - Identifier          (e.g. `if (x)`)
 *       - PrefixUnary !expr   (e.g. `if (!x)`)
 *       - PropertyAccess      (e.g. `if (result.ok)`)
 *       - PrefixUnary !prop   (e.g. `if (!result.ok)`)
 *
 * Every other shape is left alone (and will be handled by hand in the
 * long tail or left for a later refinement).
 *
 * Usage: node scripts/codemods/no-conditional-expect.mjs <file> [file...]
 */

import { Project, SyntaxKind } from 'ts-morph';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('usage: no-conditional-expect.mjs <file...>');
  process.exit(2);
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
});

function invertTest(testNode) {
  const txt = testNode.getText();
  if (testNode.getKind() === SyntaxKind.PrefixUnaryExpression) {
    const op = testNode.getOperatorToken();
    if (op === SyntaxKind.ExclamationToken) {
      // !X  →  X
      return testNode.getOperand().getText();
    }
  }
  if (testNode.getKind() === SyntaxKind.BinaryExpression) {
    const opTok = testNode.getOperatorToken().getText();
    const flip = {
      '===': '!==',
      '!==': '===',
      '==': '!=',
      '!=': '==',
    }[opTok];
    if (flip) {
      const lhs = testNode.getLeft().getText();
      const rhs = testNode.getRight().getText();
      return `${lhs} ${flip} ${rhs}`;
    }
  }
  // default: prefix with `!` and wrap in parens for safety
  return `!(${txt})`;
}

function containsExpectCall(node) {
  let found = false;
  node.forEachDescendant((d, traversal) => {
    if (d.getKind() === SyntaxKind.CallExpression) {
      const expr = d.getExpression();
      // `expect(` at the head of a call expression
      if (
        expr.getKind() === SyntaxKind.Identifier &&
        expr.getText() === 'expect'
      ) {
        found = true;
        traversal.stop();
      }
      // `expect(x).foo.bar(...)` chains also start with an inner `expect(`
      // which will be caught by the recursion above; nothing special here.
    }
  });
  return found;
}

function shapeOkForInversion(testNode) {
  const k = testNode.getKind();
  if (k === SyntaxKind.Identifier) return true;
  if (k === SyntaxKind.PropertyAccessExpression) return true;
  if (k === SyntaxKind.CallExpression) return true;
  if (k === SyntaxKind.PrefixUnaryExpression) {
    const op = testNode.getOperatorToken();
    if (op !== SyntaxKind.ExclamationToken) return false;
    const inner = testNode.getOperand();
    const ik = inner.getKind();
    return (
      ik === SyntaxKind.Identifier ||
      ik === SyntaxKind.PropertyAccessExpression ||
      ik === SyntaxKind.CallExpression
    );
  }
  if (k === SyntaxKind.BinaryExpression) {
    const opTok = testNode.getOperatorToken().getText();
    return ['===', '!==', '==', '!='].includes(opTok);
  }
  return false;
}

/**
 * Attempt to rewrite a single IfStatement into a narrowing-throw form.
 * Returns true if a rewrite was applied, false if the statement does not
 * match the target pattern.
 */
function rewriteIfStatement(sf, ifStmt) {
  if (ifStmt.wasForgotten()) return false;

  const elseStmt = ifStmt.getElseStatement();
  if (elseStmt) return false;

  const thenStmt = ifStmt.getThenStatement();
  if (!thenStmt || thenStmt.getKind() !== SyntaxKind.Block) return false;

  if (!containsExpectCall(thenStmt)) return false;

  const testNode = ifStmt.getExpression();
  if (!shapeOkForInversion(testNode)) return false;

  // Only rewrite when the IfStatement is a direct child of a Block (i.e.
  // at statement level inside a test body). Avoid nested-if rewrites for now.
  const parent = ifStmt.getParent();
  if (!parent || parent.getKind() !== SyntaxKind.Block) return false;

  const inverted = invertTest(testNode);

  // Body text without the outer braces.
  const blockText = thenStmt.getText();
  // Strip first line `{` and last line `}` conservatively:
  //   block starts with `{` and ends with `}`; we slice.
  // We avoid regex quantifiers adjacent to quantifiers (super-linear
  // backtracking) by splitting on newlines and trimming the first/last
  // non-empty lines.
  const blockLines = blockText.split('\n');
  // Remove leading `{` from the first line.
  if (blockLines.length > 0) {
    blockLines[0] = blockLines[0].replace(/^\{/, '');
  }
  // Remove trailing `}` from the last line.
  const lastIdx = blockLines.length - 1;
  if (lastIdx >= 0) {
    blockLines[lastIdx] = blockLines[lastIdx].replace(/\}$/, '');
  }
  // Drop now-empty leading/trailing lines left by brace removal.
  while (blockLines.length > 0 && blockLines[0].trim() === '') {
    blockLines.shift();
  }
  while (
    blockLines.length > 0 &&
    blockLines[blockLines.length - 1].trim() === ''
  ) {
    blockLines.pop();
  }
  const innerText = blockLines.join('\n');

  // Figure out the indentation of the IfStatement itself so our replacement
  // keeps alignment.
  const ifStart = ifStmt.getStart();
  const sourceText = sf.getFullText();
  // find start of line
  let lineStart = ifStart;
  while (lineStart > 0 && sourceText[lineStart - 1] !== '\n') lineStart--;
  const indent = sourceText.slice(lineStart, ifStart);

  // Build replacement: narrowing throw + hoisted body (already indented one
  // level deeper than `indent`, so dedent by the block's own leading spaces
  // relative to indent + 2 spaces). We detect the extra indentation:
  // every non-empty line inside the block begins with (indent + "  ").
  const dedentPrefix = indent + '  ';
  const dedented = innerText
    .split('\n')
    .map((line) => (line.startsWith(dedentPrefix) ? line.slice(2) : line))
    .join('\n');

  // Preserve block scope by wrapping hoisted body in braces
  const replacement =
    `if (${inverted}) throw new Error('unreachable: narrowing failed');\n` +
    indent +
    `{\n` +
    dedented +
    `\n${indent}}`;

  ifStmt.replaceWithText(replacement);
  return true;
}

let totalRewrites = 0;

for (const file of argv) {
  const sf = project.addSourceFileAtPath(file);
  let fileRewrites = 0;

  // We collect candidate IfStatements bottom-up to avoid positional drift.
  const ifs = sf.getDescendantsOfKind(SyntaxKind.IfStatement);

  // Process in reverse order (later in source first) to keep text offsets stable.
  for (let i = ifs.length - 1; i >= 0; i--) {
    if (rewriteIfStatement(sf, ifs[i])) {
      fileRewrites++;
    }
  }

  if (fileRewrites > 0) {
    sf.saveSync();
  }
  console.log(`${file}\t${fileRewrites}`);
  totalRewrites += fileRewrites;
}

console.log(`total_rewrites=${totalRewrites}`);

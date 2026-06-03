#!/usr/bin/env node
/**
 * Codemod: convert the
 *
 *   try {
 *     await store.foo(...);
 *     expect.unreachable('should have thrown');
 *   } catch (err) {
 *     expect(err).toBeInstanceOf(X);
 *     expect((err as X).code).toBe('CODE');
 *     // ...more expect(err...) lines
 *   }
 *
 * pattern (which violates vitest/no-conditional-expect) into
 *
 *   let err: unknown;
 *   try {
 *     await store.foo(...);
 *   } catch (e) {
 *     err = e;
 *   }
 *   expect(err).toBeDefined();
 *   expect(err).toBeInstanceOf(X);
 *   expect((err as X).code).toBe('CODE');
 *   // ...
 *
 * Only rewrites `try { ... ; expect.unreachable(...) ; } catch (<name>) { <expects> }`
 * shapes. Anything else is left alone.
 *
 * Usage: node scripts/codemods/nce-try-unreachable.mjs <file...>
 */

import { Project, SyntaxKind } from 'ts-morph';

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('usage: nce-try-unreachable.mjs <file...>');
  process.exit(2);
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
});

let total = 0;

for (const file of argv) {
  const sf = project.addSourceFileAtPath(file);
  let rewrites = 0;

  const trys = sf.getDescendantsOfKind(SyntaxKind.TryStatement);
  // iterate bottom-up to keep positions stable
  for (let i = trys.length - 1; i >= 0; i--) {
    const tryStmt = trys[i];
    if (tryStmt.wasForgotten()) continue;

    const tryBlock = tryStmt.getTryBlock();
    const catchClause = tryStmt.getCatchClause();
    if (!catchClause) continue;
    if (tryStmt.getFinallyBlock()) continue;

    const tryBodyStmts = tryBlock.getStatements();
    if (tryBodyStmts.length < 2) continue;

    // Last statement must be `expect.unreachable(...)` expression statement.
    const last = tryBodyStmts[tryBodyStmts.length - 1];
    if (last.getKind() !== SyntaxKind.ExpressionStatement) continue;
    const lastText = last.getText().trim();
    if (!/^expect\.unreachable\(/.test(lastText)) continue;

    const catchBlock = catchClause.getBlock();
    const catchVarDecl = catchClause.getVariableDeclaration();
    if (!catchVarDecl) continue;
    const catchName = catchVarDecl.getName();

    // Build replacement text.
    // Use indentation of the try statement's starting column.
    const sourceText = sf.getFullText();
    let lineStart = tryStmt.getStart();
    while (lineStart > 0 && sourceText[lineStart - 1] !== '\n') lineStart--;
    const indent = sourceText.slice(lineStart, tryStmt.getStart());

    // Preserve try-body statements except the final expect.unreachable
    const keptTryStmts = tryBodyStmts
      .slice(0, -1)
      .map((s) => indent + '  ' + s.getText())
      .join('\n');

    // Preserve catch-body statements but rename `err` references to the
    // outer variable. We reuse the catch-parameter name, so no renaming
    // needed.
    const catchBodyStmts = catchBlock.getStatements();
    const keptCatchStmts = catchBodyStmts
      .map((s) => indent + s.getText())
      .join('\n');

    const replacement =
      `let ${catchName}: unknown;\n` +
      indent +
      `try {\n` +
      keptTryStmts +
      `\n` +
      indent +
      `} catch (__caught) {\n` +
      indent +
      `  ${catchName} = __caught;\n` +
      indent +
      `}\n` +
      indent +
      `expect(${catchName}).toBeDefined();\n` +
      keptCatchStmts;

    tryStmt.replaceWithText(replacement);
    rewrites++;
  }

  if (rewrites > 0) sf.saveSync();
  console.log(`${file}\t${rewrites}`);
  total += rewrites;
}

console.log(`total_rewrites=${total}`);

#!/usr/bin/env node
/**
 * Codemod: rewrite `import('mod').Foo` type annotations into hoisted
 * `import type { Foo } from 'mod'` statements.
 *
 * - Dynamic imports (e.g. `await import(...)`) are NOT touched.
 * - Only `ImportTypeNode` AST nodes (i.e., `import('mod').X` used in type
 *   position) are rewritten.
 * - Repeated imports from the same module are merged.
 * - If the module is already imported at the top (as value or type), we
 *   extend the existing import.
 *
 * Usage: node scripts/codemod-import-type-annotations.mjs <file> [<file> ...]
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import path from 'node:path';
import process from 'node:process';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    'Usage: codemod-import-type-annotations.mjs <file> [<file> ...]',
  );
  process.exit(1);
}

const project = new Project({
  tsConfigFilePath: undefined,
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, jsx: 4 /* Preserve */ },
});

let totalRewrites = 0;
let totalFiles = 0;

for (const absPath of files) {
  const resolved = path.resolve(absPath);
  const sf = project.addSourceFileAtPath(resolved);

  /**
   * Map<modulePath, Set<namedType>>
   * modulePath string → set of types to add as `import type`.
   */
  const needed = new Map();
  /**
   * Map<modulePath, Map<alias, modulePath>>
   * For `(typeof import('mod'))['X']` style we keep it in-place unless it's
   * a plain `import('mod').X`; TS does not let us easily refactor those.
   */

  // Walk all ImportTypeNodes.
  const importTypes = sf.getDescendantsOfKind(SyntaxKind.ImportType);
  if (importTypes.length === 0) continue;

  let rewritesInFile = 0;

  for (const node of importTypes) {
    // argument is a LiteralTypeNode containing a StringLiteral
    const argument = node.getArgument();
    if (!argument) continue;
    const stringLit = argument
      .asKindOrThrow(SyntaxKind.LiteralType)
      .getLiteral();
    if (!Node.isStringLiteral(stringLit)) continue;
    const modulePath = stringLit.getLiteralText();

    // qualifier is the `.Foo` part (EntityName). We only handle simple
    // single-identifier qualifiers like `.Foo`. We skip nested (e.g. `.A.B`).
    const qualifier = node.getQualifier();
    const isTypeofImport = node.compilerNode.isTypeOf === true;
    const hasTypeArguments = node.getTypeArguments().length > 0;

    // Skip generic variants (`import('x').Foo<T>`) — still work, but rarer.
    if (hasTypeArguments) continue;

    // Skip `typeof import(...)` forms — those commonly index into the module
    // object (e.g. `(typeof import('pkg'))['Foo']`) and need different handling.
    if (isTypeofImport) continue;

    if (!qualifier) continue;
    if (!Node.isIdentifier(qualifier)) continue;
    const typeName = qualifier.getText();

    // Register need.
    if (!needed.has(modulePath)) needed.set(modulePath, new Set());
    needed.get(modulePath).add(typeName);

    // Replace node text with just the type name.
    node.replaceWithText(typeName);
    rewritesInFile++;
  }

  if (rewritesInFile === 0) continue;

  // Now add/merge imports.
  for (const [modulePath, typeNames] of needed) {
    const existing = sf
      .getImportDeclarations()
      .find((d) => d.getModuleSpecifierValue() === modulePath);

    if (!existing) {
      sf.addImportDeclaration({
        moduleSpecifier: modulePath,
        isTypeOnly: true,
        namedImports: [...typeNames].map((name) => ({ name })),
      });
      continue;
    }

    // Existing import found — extend with missing type names.
    const already = new Set(
      existing.getNamedImports().map((ni) => ni.getName()),
    );
    const missing = [...typeNames].filter((n) => !already.has(n));
    if (missing.length === 0) continue;
    for (const name of missing) {
      existing.addNamedImport({ name, isTypeOnly: !existing.isTypeOnly() });
    }
  }

  sf.saveSync();
  totalRewrites += rewritesInFile;
  totalFiles++;
  console.log(
    `${path.relative(process.cwd(), resolved)}: ${rewritesInFile} rewrites`,
  );
}

console.log(`\nTotal: ${totalRewrites} rewrites across ${totalFiles} files`);

/**
 * Codemod: Fix @typescript-eslint/consistent-type-imports
 *
 * Uses the TypeScript compiler to determine which imports are only used
 * as types and converts them to `import type` declarations.
 *
 * Usage: npx tsx scripts/codemods/fix-type-imports.ts <glob>
 * Example: npx tsx scripts/codemods/fix-type-imports.ts "packages/core/src/**\/*.ts"
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import * as path from 'path';
import { glob } from 'glob';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/codemods/fix-type-imports.ts <glob>');
  process.exit(1);
}

const pattern = args[0];
const dryRun = args.includes('--dry-run');

const files = glob.sync(pattern, { absolute: true });
console.log(`Found ${files.length} files matching ${pattern}`);

const project = new Project({
  tsConfigFilePath: path.resolve('tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
});

for (const file of files) {
  project.addSourceFileAtPath(file);
}

let totalFixed = 0;
let filesModified = 0;

for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath();
  let fileFixed = 0;

  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    if (importDecl.isTypeOnly()) continue;

    const namedImports = importDecl.getNamedImports();
    const defaultImport = importDecl.getDefaultImport();

    if (namedImports.length === 0 && !defaultImport) continue;

    // Check if ALL imports in this declaration are type-only
    let allTypeOnly = true;

    if (defaultImport) {
      if (!isSymbolTypeOnly(sourceFile, defaultImport.getText())) {
        allTypeOnly = false;
      }
    }

    if (allTypeOnly) {
      for (const ni of namedImports) {
        if (ni.isTypeOnly()) continue;
        const alias = ni.getAliasNode()?.getText();
        const identifier = alias ?? ni.getName();
        if (!isSymbolTypeOnly(sourceFile, identifier)) {
          allTypeOnly = false;
          break;
        }
      }
    }

    if (allTypeOnly) {
      importDecl.setIsTypeOnly(true);
      for (const ni of importDecl.getNamedImports()) {
        if (ni.isTypeOnly()) ni.setIsTypeOnly(false);
      }
      fileFixed++;
    } else {
      // Mark individual type-only named imports with inline `type`
      for (const ni of namedImports) {
        if (ni.isTypeOnly()) continue;
        const alias = ni.getAliasNode()?.getText();
        const identifier = alias ?? ni.getName();
        if (isSymbolTypeOnly(sourceFile, identifier)) {
          ni.setIsTypeOnly(true);
          fileFixed++;
        }
      }
    }
  }

  if (fileFixed > 0) {
    totalFixed += fileFixed;
    filesModified++;
    if (!dryRun) {
      sourceFile.saveSync();
    }
    console.log(
      `${dryRun ? '[DRY RUN] ' : ''}${path.relative(process.cwd(), filePath)}: ${fileFixed} imports fixed`,
    );
  }
}

console.log(
  `\n${dryRun ? '[DRY RUN] ' : ''}Done: ${totalFixed} imports fixed across ${filesModified} files`,
);

/**
 * Determines if a symbol imported with the given name is only used in type
 * positions throughout the file.
 *
 * Strategy: find every Identifier with matching text that isn't part of the
 * import declaration itself. For each one, walk up the AST. If any usage is
 * a value-level usage, return false.
 */
function isSymbolTypeOnly(sourceFile: any, name: string): boolean {
  const identifiers = sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id: any) => id.getText() === name);

  let usageCount = 0;

  for (const id of identifiers) {
    // Skip the import itself
    if (isPartOfImport(id)) continue;

    usageCount++;

    if (isValueUsage(id)) {
      return false;
    }
  }

  // If there are no usages at all, it's safe to make type-only
  // (it's unused, but that's a separate lint issue)
  return true;
}

function isPartOfImport(node: any): boolean {
  let current = node;
  while (current) {
    if (Node.isImportDeclaration(current)) return true;
    current = current.getParent();
  }
  return false;
}

/**
 * Returns true if this identifier is used as a runtime value
 * (not just in a type position).
 */
function isValueUsage(id: any): boolean {
  const parent = id.getParent();
  if (!parent) return true; // conservative: assume value

  const parentKind = parent.getKind();

  // Definitely type-only contexts
  if (
    Node.isTypeReference(parent) ||
    Node.isTypeQuery(parent) ||
    Node.isTypeAliasDeclaration(parent) ||
    Node.isInterfaceDeclaration(parent) ||
    Node.isTypeParameterDeclaration(parent)
  ) {
    return false;
  }

  // ExpressionWithTypeArguments — tricky!
  // In `class Foo extends Bar<T>` → Bar is a VALUE usage
  // In `interface Foo extends Bar` → Bar is a TYPE usage
  // In `class Foo implements Bar` → Bar is a TYPE usage
  if (Node.isExpressionWithTypeArguments(parent)) {
    const heritage = parent.getParent();
    if (heritage && Node.isHeritageClause(heritage)) {
      const token = heritage.getToken();
      if (token === SyntaxKind.ExtendsKeyword) {
        // Check owner: class extends = value, interface extends = type
        const owner = heritage.getParent();
        if (owner && Node.isClassDeclaration(owner)) {
          return true; // class extends = runtime value usage
        }
        if (owner && Node.isClassExpression(owner)) {
          return true; // class expression extends = runtime value usage
        }
        return false; // interface extends = type only
      }
      // implements keyword = type only
      return false;
    }
    return false; // shouldn't happen, but treat as type
  }

  // If the parent is a type annotation node kind, it's type-only
  if (parentKind === SyntaxKind.TypeAnnotation) return false;
  if (parentKind === SyntaxKind.TypeParameter) return false;

  // Walk up: if we're inside a type context, it's type-only
  if (isInsideTypeContext(id)) return false;

  // Everything else is a value usage
  return true;
}

/**
 * Walk up the AST from this node. If we encounter a type-only context
 * before hitting a statement/block boundary, return true.
 */
function isInsideTypeContext(node: any): boolean {
  let current = node.getParent();
  while (current) {
    // Type contexts
    if (
      Node.isTypeReference(current) ||
      Node.isTypeLiteral(current) ||
      Node.isUnionTypeNode(current) ||
      Node.isIntersectionTypeNode(current) ||
      Node.isArrayTypeNode(current) ||
      Node.isTupleTypeNode(current) ||
      Node.isTypeAliasDeclaration(current) ||
      Node.isInterfaceDeclaration(current) ||
      Node.isTypeParameterDeclaration(current) ||
      Node.isMappedTypeNode(current) ||
      Node.isConditionalTypeNode(current) ||
      Node.isIndexedAccessTypeNode(current) ||
      Node.isTypeQuery(current) ||
      Node.isParenthesizedTypeNode(current)
    ) {
      return true;
    }

    // ExpressionWithTypeArguments inside interface/implements = type
    // But inside class extends = value (handled by isValueUsage above,
    // so by the time we get here it would be for the type args part)
    if (Node.isExpressionWithTypeArguments(current)) {
      const heritage = current.getParent();
      if (heritage && Node.isHeritageClause(heritage)) {
        const token = heritage.getToken();
        if (token === SyntaxKind.ExtendsKeyword) {
          const owner = heritage.getParent();
          if (
            owner &&
            (Node.isClassDeclaration(owner) || Node.isClassExpression(owner))
          ) {
            return false; // inside class extends = value context
          }
        }
      }
      return true;
    }

    const kind = current.getKind();
    if (kind === SyntaxKind.TypeAnnotation || kind === SyntaxKind.TypeParameter)
      return true;

    // Stop at statement/block/function boundaries
    if (
      Node.isStatement(current) ||
      Node.isBlock(current) ||
      Node.isSourceFile(current) ||
      Node.isFunctionDeclaration(current) ||
      Node.isMethodDeclaration(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionExpression(current) ||
      Node.isClassDeclaration(current)
    ) {
      return false;
    }

    current = current.getParent();
  }
  return false;
}

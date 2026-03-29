/**
 * Codemod: Fix @typescript-eslint/strict-boolean-expressions
 *
 * Only fixes conditions in if/while/for/ternary statements.
 * Does NOT fix && / || operands (those are often intentional
 * short-circuit evaluation returning non-boolean values).
 *
 * Usage: npx tsx scripts/codemods/fix-strict-boolean.ts <glob>
 */

import * as ts from 'typescript';
import * as path from 'path';
import * as fs from 'fs';
import { glob } from 'glob';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npx tsx scripts/codemods/fix-strict-boolean.ts <glob>');
  process.exit(1);
}

const pattern = args[0];
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

const files = glob.sync(pattern, { absolute: true });
console.log(`Found ${files.length} files matching ${pattern}`);

const configPath = ts.findConfigFile(
  process.cwd(),
  ts.sys.fileExists,
  'tsconfig.json',
);
if (!configPath) {
  console.error('Could not find tsconfig.json');
  process.exit(1);
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath),
);

const program = ts.createProgram(files, parsedConfig.options);
const checker = program.getTypeChecker();

let totalFixed = 0;
let filesModified = 0;

for (const file of files) {
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) continue;

  const replacements: Array<{
    start: number;
    end: number;
    text: string;
    original: string;
  }> = [];

  function visit(node: ts.Node) {
    // Fix conditions in if/while/for/do-while/ternary
    if (ts.isIfStatement(node)) {
      fixTopLevelCondition(node.expression);
    } else if (ts.isWhileStatement(node)) {
      fixTopLevelCondition(node.expression);
    } else if (ts.isDoStatement(node)) {
      fixTopLevelCondition(node.expression);
    } else if (ts.isForStatement(node) && node.condition) {
      fixTopLevelCondition(node.condition);
    } else if (ts.isConditionalExpression(node)) {
      fixTopLevelCondition(node.condition);
    }

    ts.forEachChild(node, visit);
  }

  /**
   * Fix a top-level condition expression. If it's a compound expression
   * (&&, ||), recursively fix each leaf that needs it.
   */
  function fixTopLevelCondition(expr: ts.Expression) {
    // Unwrap parentheses
    while (ts.isParenthesizedExpression(expr)) {
      expr = expr.expression;
    }

    // If it's && or ||, fix each operand independently
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken
      ) {
        fixTopLevelCondition(expr.left);
        fixTopLevelCondition(expr.right);
        return;
      }
    }

    // Fix this leaf expression
    fixLeafCondition(expr);
  }

  function fixLeafCondition(expr: ts.Expression) {
    if (isAlreadyBooleanExpression(expr)) return;

    // Skip assignment expressions in conditions: if ((match = regex.exec(s)))
    // Wrapping with != null would change what gets assigned
    if (containsAssignment(expr)) return;

    // Handle !expr
    if (
      ts.isPrefixUnaryExpression(expr) &&
      expr.operator === ts.SyntaxKind.ExclamationToken
    ) {
      const operand = expr.operand;
      const type = checker.getTypeAtLocation(operand);
      const fix = getNegatedFix(operand, type, sourceFile);
      if (fix) {
        replacements.push({
          start: expr.getStart(sourceFile),
          end: expr.getEnd(),
          text: fix,
          original: expr.getText(sourceFile),
        });
      }
      return;
    }

    const type = checker.getTypeAtLocation(expr);
    const fix = getPositiveFix(expr, type, sourceFile);
    if (fix) {
      replacements.push({
        start: expr.getStart(sourceFile),
        end: expr.getEnd(),
        text: fix,
        original: expr.getText(sourceFile),
      });
    }
  }

  visit(sourceFile);

  if (replacements.length > 0) {
    // Sort from end to start
    replacements.sort((a, b) => b.start - a.start);

    // Remove overlapping (keep outer)
    const filtered: typeof replacements = [];
    for (const r of replacements) {
      const overlaps = filtered.some(
        (f) =>
          (r.start >= f.start && r.start < f.end) ||
          (r.end > f.start && r.end <= f.end),
      );
      if (!overlaps) {
        filtered.push(r);
      }
    }

    if (!dryRun) {
      let text = sourceFile.getFullText();
      for (const r of filtered) {
        text = text.substring(0, r.start) + r.text + text.substring(r.end);
      }
      fs.writeFileSync(file, text);
    }

    totalFixed += filtered.length;
    filesModified++;
    const relPath = path.relative(process.cwd(), file);
    console.log(
      `${dryRun ? '[DRY RUN] ' : ''}${relPath}: ${filtered.length} fixes`,
    );

    if (verbose) {
      for (const r of filtered) {
        console.log(`  ${r.original} → ${r.text}`);
      }
    }
  }
}

console.log(
  `\n${dryRun ? '[DRY RUN] ' : ''}Done: ${totalFixed} fixes across ${filesModified} files`,
);

function containsAssignment(expr: ts.Expression): boolean {
  // Unwrap parens
  while (ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsToken ||
      op === ts.SyntaxKind.PlusEqualsToken ||
      op === ts.SyntaxKind.MinusEqualsToken ||
      op === ts.SyntaxKind.BarBarEqualsToken ||
      op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandEqualsToken
    ) {
      return true;
    }
  }
  return false;
}

function isAlreadyBooleanExpression(expr: ts.Expression): boolean {
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    return (
      op === ts.SyntaxKind.EqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsToken ||
      op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken ||
      op === ts.SyntaxKind.InstanceOfKeyword ||
      op === ts.SyntaxKind.InKeyword
    );
  }

  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return true;

  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    // Already negated — will handle separately
    return false;
  }

  // Method/function calls that return boolean
  const type = checker.getTypeAtLocation(expr);
  if (isBooleanType(type)) return true;

  return false;
}

function getPositiveFix(
  expr: ts.Expression,
  type: ts.Type,
  sf: ts.SourceFile,
): string | null {
  const exprText = expr.getText(sf);

  if (isBooleanType(type)) return null;

  if (isNullableType(type)) {
    const nonNull = type.getNonNullableType();
    // Only safe to use `!= null` if the non-null type is purely object-like
    // (no boolean, string, or number components that have falsy values)
    if (hasPrimitiveFalsyTypes(nonNull)) return null;
    return `${exprText} != null`;
  }

  // Non-nullable types: skip
  return null;
}

function getNegatedFix(
  operand: ts.Expression,
  type: ts.Type,
  sf: ts.SourceFile,
): string | null {
  const exprText = operand.getText(sf);

  if (isBooleanType(type)) return null;

  if (isNullableType(type)) {
    const nonNull = type.getNonNullableType();
    if (hasPrimitiveFalsyTypes(nonNull)) return null;
    return `${exprText} == null`;
  }

  return null;
}

/**
 * Returns true if the type contains any primitive types that have falsy values
 * (boolean has `false`, string has `""`, number has `0`).
 * For these types, `!= null` would change the semantics of truthiness checks.
 */
function hasPrimitiveFalsyTypes(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some((t) => hasPrimitiveFalsyTypes(t));
  }
  return (
    isBooleanType(type) ||
    isStringType(type) ||
    isNumberType(type) ||
    (type.flags & ts.TypeFlags.Any) !== 0
  );
}

function isBooleanType(type: ts.Type): boolean {
  return (
    (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0
  );
}

function isNullableType(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.some(
      (t) =>
        (t.flags & ts.TypeFlags.Null) !== 0 ||
        (t.flags & ts.TypeFlags.Undefined) !== 0,
    );
  }
  return false;
}

function isStringType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.StringLike) !== 0;
}

function isNumberType(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.NumberLike) !== 0;
}

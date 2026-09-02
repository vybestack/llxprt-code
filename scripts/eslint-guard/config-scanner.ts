/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

import { SCOPE_STRING_PATTERN, isCommentOnlyLine } from './constants.ts';
import {
  hasInlineEslintDirectiveInState,
  hasTypeScriptSuppressionInState,
  scanTemplateLiteralState,
} from './directive-scanner.ts';
import { stripInlineComment } from './bypass-detector.ts';
import { isProductionCheckedSourceFile, listTsFiles } from './scanners.ts';
import type { Violation } from './types.ts';

interface BlockCommentState {
  inBlockComment: boolean;
}

function repositoryTypeScriptFiles(rootDir: string) {
  const roots = [join(rootDir, 'packages'), join(rootDir, 'integration-tests')];
  return roots.flatMap((root) => listTsFiles(root));
}

function sourceFileFor(file: string, content: string) {
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function collectZodAliases(sourceFile: ts.SourceFile) {
  const aliases = new Set<string>();
  for (const statement of sourceFile.statements) {
    collectZodAliasesFromStatement(statement, aliases);
  }
  return aliases;
}

function collectZodAliasesFromStatement(
  statement: ts.Node,
  aliases: Set<string>,
) {
  if (
    !ts.isImportDeclaration(statement) ||
    !ts.isStringLiteral(statement.moduleSpecifier) ||
    statement.moduleSpecifier.text !== 'zod'
  ) {
    return;
  }
  const importClause = statement.importClause;
  if (importClause?.name) {
    aliases.add(importClause.name.text);
  }
  const namedBindings = importClause?.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings)) {
    aliases.add(namedBindings.name.text);
  }
  if (namedBindings && ts.isNamedImports(namedBindings)) {
    collectNamedZodImports(namedBindings, aliases);
  }
}

function collectNamedZodImports(
  namedBindings: ts.NamedImports,
  aliases: Set<string>,
) {
  for (const element of namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (importedName === 'z') {
      aliases.add(element.name.text);
    }
  }
}

function isZAnyCall(node: ts.Node, zodAliases: Set<string>) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    !ts.isIdentifier(node.expression.expression)
  ) {
    return false;
  }
  return (
    zodAliases.has(node.expression.expression.text) &&
    node.expression.name.text === 'any'
  );
}

function scanTypeScriptAstForEscapeHatches(
  file: string,
  sourceFile: ts.SourceFile,
  issueNumber: string,
  rootDir: string,
) {
  const violations: Violation[] = [];
  const relativePath = relative(rootDir, file).replace(/\\/g, '/');

  const zodAliases = collectZodAliases(sourceFile);
  function addNodeViolation(node: ts.Node, message: string, content: string) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      file: relativePath,
      lineNumber: position.line + 1,
      message,
      content,
    });
  }

  // Issue #2227 intentionally scans every repository TypeScript file in
  // packages and integration-tests, including tests, setup files, and helpers.
  // The policy forbids explicit any and z.any everywhere in that universe.
  function visit(node: ts.Node) {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      addNodeViolation(
        node,
        `explicit any type keywords are forbidden in repository TypeScript (#${issueNumber}).`,
        node.getText(sourceFile),
      );
    }

    if (isZAnyCall(node, zodAliases)) {
      addNodeViolation(
        node,
        `z.any() calls are forbidden in repository TypeScript (#${issueNumber}).`,
        node.getText(sourceFile),
      );
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function scanTypeScriptTextForEscapeHatches(
  file: string,
  content: string,
  issueNumber: string,
  rootDir: string,
) {
  const relativePath = relative(rootDir, file).replace(/\\/g, '/');
  const lines = content.split(String.fromCharCode(10));
  const violations: Violation[] = [];
  let templateLiteralState = { inTemplate: false, exprDepth: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (hasInlineEslintDirectiveInState(line, templateLiteralState)) {
      violations.push({
        file: relativePath,
        lineNumber: i + 1,
        message: `Inline ESLint disable/enable directives are forbidden in repository TypeScript (#${issueNumber}).`,
        content: line,
      });
    }
    if (hasTypeScriptSuppressionInState(line, templateLiteralState)) {
      // Production source is already covered by scanRootTypeScriptSuppressions
      // (#2189). Issue #2227 extends the durable ban to the remaining checked
      // repository TypeScript files, including tests, setup files, and helpers.
      const isAlreadyCoveredByRootScan =
        isProductionCheckedSourceFile(relativePath);
      if (!isAlreadyCoveredByRootScan) {
        violations.push({
          file: relativePath,
          lineNumber: i + 1,
          message: `TypeScript suppression directives (@ts-ignore/@ts-expect-error/@ts-nocheck) are forbidden in repository TypeScript (#${issueNumber}).`,
          content: line,
        });
      }
    }
    templateLiteralState = scanTemplateLiteralState(line, templateLiteralState);
  }

  return violations;
}

function stripBlockCommentsForSnippet(
  lines: string[],
  startsInBlockComment: boolean,
) {
  const parts: string[] = [];
  let inBlock = startsInBlockComment;

  for (const rawLine of lines) {
    const result = stripBlockCommentsFromLine(rawLine, inBlock);
    inBlock = result.inBlock;
    parts.push(result.output);
  }

  return parts.join(' ');
}

function stripBlockCommentsFromLine(rawLine: string, inBlock: boolean) {
  let remaining = rawLine;
  let output = '';
  let state = inBlock;

  while (remaining.length > 0) {
    const step = advanceBlockCommentState(remaining, state);
    output += step.output;
    remaining = step.remaining;
    state = step.inBlock;
  }

  return { output, inBlock: state };
}

function advanceBlockCommentState(remaining: string, inBlock: boolean) {
  if (inBlock) {
    const closeIndex = remaining.indexOf('*/');
    if (closeIndex === -1) {
      return { output: '', remaining: '', inBlock: true };
    }
    return {
      output: '',
      remaining: remaining.slice(closeIndex + 2),
      inBlock: false,
    };
  }

  const openIndex = remaining.indexOf('/*');
  if (openIndex === -1) {
    return { output: remaining, remaining: '', inBlock: false };
  }

  return {
    output: remaining.slice(0, openIndex),
    remaining: remaining.slice(openIndex + 2),
    inBlock: true,
  };
}

const ESLINT_CONFIG_CHECKS = [
  {
    anchor: /\blegacyDirectiveCleanupScopes\b/,
    pattern: /\blegacyDirectiveCleanupScopes\b/,
    message: 'legacyDirectiveCleanupScopes must be removed',
  },
  {
    anchor: /\bcompletedDirectiveCleanupScopes\b/,
    pattern: /\bcompletedDirectiveCleanupScopes\b/,
    message: 'completedDirectiveCleanupScopes must be removed',
  },
  {
    anchor: /['"]@typescript-eslint\/no-explicit-any['"]/,
    pattern:
      /['"]@typescript-eslint\/no-explicit-any['"]\s*:\s*(?:['"](?:off|warn)['"]|[01]\b)|['"]@typescript-eslint\/no-explicit-any['"]\s*:\s*\[\s*(?:['"](?:off|warn)['"]|[01]\b)/,
    message:
      '@typescript-eslint/no-explicit-any off/warn entries are forbidden',
  },
  {
    anchor: /['"]eslint-comments\/no-use['"]/,
    pattern:
      /['"]eslint-comments\/no-use['"]\s*:\s*(?:['"]off['"]|0\b)|['"]eslint-comments\/no-use['"]\s*:\s*\[\s*(?:['"]off['"]|0\b)/,
    message: 'eslint-comments/no-use off entries are forbidden',
  },
  {
    anchor: /\breportUnusedDisableDirectives\b/,
    pattern:
      /\breportUnusedDisableDirectives\s*:\s*(?:['"]off['"]|0\b|false\b)/,
    message: 'reportUnusedDisableDirectives off entries are forbidden',
  },
];

function stripLeadingBlockComments(
  candidateLine: string,
  state: BlockCommentState,
) {
  let line = candidateLine;
  let trimmedLine = line.trim();

  if (state.inBlockComment) {
    const closeIndex = line.indexOf('*/');
    if (closeIndex === -1) {
      return { line, trimmedLine, skip: true, inBlockComment: true };
    }
    state.inBlockComment = false;
    line = line.slice(closeIndex + 2);
    trimmedLine = line.trim();
  }

  while (trimmedLine.startsWith('/*')) {
    const closeIndex = line.indexOf('*/');
    if (closeIndex === -1) {
      state.inBlockComment = true;
      return { line, trimmedLine, skip: true, inBlockComment: true };
    }
    line = line.slice(closeIndex + 2);
    trimmedLine = line.trim();
  }

  return { line, trimmedLine, skip: false, inBlockComment: false };
}

function shouldSkipConfigLine(
  trimmedLine: string,
  candidateLine: string,
  inBlockComment: boolean,
) {
  return (
    inBlockComment || trimmedLine === '' || isCommentOnlyLine(candidateLine)
  );
}

function checkEslintConfigLine(
  line: string,
  lines: string[],
  i: number,
  candidateLine: string,
  issueNumber: string,
) {
  const violations: Violation[] = [];
  const snippetLines = [
    candidateLine,
    ...lines.slice(i + 1, Math.min(lines.length, i + 5)),
  ];
  const configSnippet = stripBlockCommentsForSnippet(
    snippetLines.map(stripInlineComment),
    false,
  );
  for (const check of ESLINT_CONFIG_CHECKS) {
    if (!check.anchor.test(candidateLine)) {
      continue;
    }
    if (check.pattern.test(configSnippet)) {
      violations.push({
        file: 'eslint.config.js',
        lineNumber: i + 1,
        message: `${check.message} (#${issueNumber}).`,
        content: candidateLine,
      });
    }
  }
  return violations;
}

function scanEslintConfigForEscapeHatches(
  rootDir: string,
  issueNumber: string,
) {
  const configPath = join(rootDir, 'eslint.config.js');
  if (!existsSync(configPath)) {
    return [];
  }

  const lines = readFileSync(configPath, 'utf8').split(String.fromCharCode(10));
  const violations: Violation[] = [];
  const state = { inBlockComment: false };

  for (let i = 0; i < lines.length; i++) {
    const lineViolations = scanEslintConfigLine(lines, i, state, issueNumber);
    violations.push(...lineViolations);
  }

  return violations;
}

function scanEslintConfigLine(
  lines: string[],
  i: number,
  state: { inBlockComment: boolean },
  issueNumber: string,
) {
  const line = lines[i];
  const result = stripLeadingBlockComments(line, state);
  if (result.skip) {
    return [];
  }
  const candidateLine = result.line;
  const trimmedLine = result.trimmedLine;

  if (shouldSkipConfigLine(trimmedLine, candidateLine, state.inBlockComment)) {
    return [];
  }

  return checkEslintConfigLine(line, lines, i, candidateLine, issueNumber);
}

function commandSegments(command: string) {
  return command
    .split(/&&|\|\||;/)
    .map((segment: string) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function eslintCommandSegments(command: string) {
  return commandSegments(command).filter((segment) => isEslintSegment(segment));
}

function isEslintSegment(segment: string) {
  const parts = segment.split(/\s+/);
  return parts.includes('eslint');
}

/**
 * Whether a segment invokes the canonical partitioned lint runner
 * (`scripts/run-lint.ts`). The runner forwards its CLI arguments to every
 * ESLint child it spawns (asserted in scripts/tests/run-lint.test.ts), so a
 * runner segment carrying --max-warnings 0 keeps every ESLint invocation of
 * a delegated lint:ci strict (#3387).
 */
function isLintRunnerSegment(segment: string) {
  return segment.split(/\s+/).includes('scripts/run-lint.ts');
}

function segmentHasMaxWarningsZero(segment: string) {
  const parts = segment.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--max-warnings' && parts[i + 1] === '0') {
      return true;
    }
    if (parts[i] === '--max-warnings=0') {
      return true;
    }
  }
  return false;
}

function lintCiKeepsMaxWarningsZero(lintCi: string) {
  const eslintSegments = eslintCommandSegments(lintCi);
  if (eslintSegments.length > 0) {
    return eslintSegments.every((segment) =>
      segmentHasMaxWarningsZero(segment),
    );
  }
  // No literal eslint invocation: lint:ci may instead delegate to the
  // partitioned runner (#3387), but the strictness flag must be spelled on
  // the runner invocation itself, where this guard can verify it. Indirect
  // delegation (e.g. `npm run lint:runner`) hides the flags and fails here.
  const runnerSegments = commandSegments(lintCi).filter(isLintRunnerSegment);
  return (
    runnerSegments.length > 0 &&
    runnerSegments.every((segment) => segmentHasMaxWarningsZero(segment))
  );
}

function scanPackageJsonLintCi(rootDir: string, issueNumber: string) {
  const packagePath = join(rootDir, 'package.json');
  if (!existsSync(packagePath)) {
    return [];
  }

  const source = readFileSync(packagePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return [
      {
        file: 'package.json',
        lineNumber: 1,
        message: `package.json must be valid JSON so lint:ci policy can be checked (#${issueNumber}).`,
        content: '',
      },
    ];
  }
  const lintCi = parsed?.scripts?.['lint:ci'];
  if (typeof lintCi === 'string' && lintCiKeepsMaxWarningsZero(lintCi)) {
    return [];
  }

  return [
    {
      file: 'package.json',
      lineNumber: 1,
      message: `lint:ci must keep --max-warnings 0 for every ESLint invocation (#${issueNumber}).`,
      content: typeof lintCi === 'string' ? lintCi : '',
    },
  ];
}

export function scanRepositoryLintEscapeHatches(
  rootDir: string,
  issueNumber: string,
) {
  const violations: Violation[] = [];
  for (const file of repositoryTypeScriptFiles(rootDir)) {
    const content = readFileSync(file, 'utf8');
    violations.push(
      ...scanTypeScriptTextForEscapeHatches(
        file,
        content,
        issueNumber,
        rootDir,
      ),
    );
    violations.push(
      ...scanTypeScriptAstForEscapeHatches(
        file,
        sourceFileFor(file, content),
        issueNumber,
        rootDir,
      ),
    );
  }
  violations.push(...scanEslintConfigForEscapeHatches(rootDir, issueNumber));
  violations.push(...scanPackageJsonLintCi(rootDir, issueNumber));
  return violations;
}

/**
 * Extracts the string-literal entries of a named const scope array
 * (legacyDirectiveCleanupScopes or completedDirectiveCleanupScopes) from
 * eslint.config.js source text. Returns the raw string values.
 */
export function extractScopeArray(scopeName: string, configSource?: string) {
  const source =
    configSource ??
    readFileSync(join(process.cwd(), 'eslint.config.js'), 'utf8');
  const startMatch = new RegExp('const\\s+' + scopeName + '\\s*=\\s*\\[').exec(
    source,
  );
  if (startMatch === null) {
    return [];
  }
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = source.indexOf(']', startIdx);
  if (endIdx === -1) {
    return [];
  }
  const body = source.slice(startIdx, endIdx);
  const entries = [];
  for (const rawLine of body.split(String.fromCharCode(10))) {
    const match = SCOPE_STRING_PATTERN.exec(rawLine);
    if (match !== null) {
      entries.push(match[1] ?? match[2] ?? match[3]);
    }
  }
  return entries;
}

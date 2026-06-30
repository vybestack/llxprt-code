/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

import { SCOPE_STRING_PATTERN, isCommentOnlyLine } from './constants.mjs';
import {
  hasInlineEslintDirectiveInState,
  hasTypeScriptSuppressionInState,
  scanTemplateLiteralState,
} from './directive-scanner.mjs';
import { stripInlineComment } from './bypass-detector.mjs';
import { isProductionCheckedSourceFile, listTsFiles } from './scanners.mjs';

function repositoryTypeScriptFiles(rootDir) {
  const roots = [join(rootDir, 'packages'), join(rootDir, 'integration-tests')];
  return roots.flatMap((root) => listTsFiles(root));
}

function sourceFileFor(file, content) {
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function collectZodAliases(sourceFile) {
  const aliases = new Set();
  for (const statement of sourceFile.statements) {
    collectZodAliasesFromStatement(statement, aliases);
  }
  return aliases;
}

function collectZodAliasesFromStatement(statement, aliases) {
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

function collectNamedZodImports(namedBindings, aliases) {
  for (const element of namedBindings.elements) {
    const importedName = element.propertyName?.text ?? element.name.text;
    if (importedName === 'z') {
      aliases.add(element.name.text);
    }
  }
}

function isZAnyCall(node, zodAliases) {
  const isCallOnProperty =
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression);
  const isZodAny =
    isCallOnProperty &&
    zodAliases.has(node.expression.expression.text) &&
    node.expression.name.text === 'any';
  return isZodAny;
}

function scanTypeScriptAstForEscapeHatches(
  file,
  sourceFile,
  issueNumber,
  rootDir,
) {
  const violations = [];
  const relativePath = relative(rootDir, file).replace(/\\/g, '/');

  const zodAliases = collectZodAliases(sourceFile);
  function addNodeViolation(node, message, content) {
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
  function visit(node) {
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
  file,
  content,
  issueNumber,
  rootDir,
) {
  const relativePath = relative(rootDir, file).replace(/\\/g, '/');
  const lines = content.split(String.fromCharCode(10));
  const violations = [];
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

function stripBlockCommentsForSnippet(lines, startsInBlockComment) {
  const parts = [];
  let inBlock = startsInBlockComment;

  for (const rawLine of lines) {
    const result = stripBlockCommentsFromLine(rawLine, inBlock);
    inBlock = result.inBlock;
    parts.push(result.output);
  }

  return parts.join(' ');
}

function stripBlockCommentsFromLine(rawLine, inBlock) {
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

function advanceBlockCommentState(remaining, inBlock) {
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

function stripLeadingBlockComments(candidateLine, state) {
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

function shouldSkipConfigLine(trimmedLine, candidateLine, inBlockComment) {
  return (
    inBlockComment || trimmedLine === '' || isCommentOnlyLine(candidateLine)
  );
}

function checkEslintConfigLine(line, lines, i, candidateLine, issueNumber) {
  const violations = [];
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

function scanEslintConfigForEscapeHatches(rootDir, issueNumber) {
  const configPath = join(rootDir, 'eslint.config.js');
  if (!existsSync(configPath)) {
    return [];
  }

  const lines = readFileSync(configPath, 'utf8').split(String.fromCharCode(10));
  const violations = [];
  const state = { inBlockComment: false };

  for (let i = 0; i < lines.length; i++) {
    const lineViolations = scanEslintConfigLine(lines, i, state, issueNumber);
    violations.push(...lineViolations);
  }

  return violations;
}

function scanEslintConfigLine(lines, i, state, issueNumber) {
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

function eslintCommandSegments(command) {
  return command
    .split(/&&|\|\||;/)
    .map((segment) => segment.trim())
    .filter((segment) => isEslintSegment(segment));
}

function isEslintSegment(segment) {
  const parts = segment.split(/\s+/);
  return parts.includes('eslint');
}

function eslintSegmentHasMaxWarningsZero(segment) {
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

function lintCiKeepsMaxWarningsZero(lintCi) {
  const eslintSegments = eslintCommandSegments(lintCi);
  return (
    eslintSegments.length > 0 &&
    eslintSegments.every((segment) => eslintSegmentHasMaxWarningsZero(segment))
  );
}

function scanPackageJsonLintCi(rootDir, issueNumber) {
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

export function scanRepositoryLintEscapeHatches(rootDir, issueNumber) {
  const violations = [];
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
export function extractScopeArray(scopeName, configSource) {
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

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { getLogger } from '../src/lib/logger';

type ViolationLevel = 'warn' | 'error';

interface Violation {
  level: ViolationLevel;
  message: string;
}

const FILE_WARN_LINES = 800;
const FILE_ERROR_LINES = 1200;
const FUNCTION_WARN_LINES = 80;
const FUNCTION_ERROR_LINES = 120;

const projectRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');

const sourceRoots = [
  path.join(projectRoot, '..', 'src'),
  path.join(projectRoot, '..', 'scripts'),
];

const violations: Violation[] = [];

for (const root of sourceRoots) {
  for (const filePath of collectSourceFiles(root)) {
    checkFileLimits(filePath);
  }
}

reportViolations(violations);

function collectSourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (entry.isFile() && isSupportedFile(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function isSupportedFile(fileName: string): boolean {
  return (
    (fileName.endsWith('.ts') || fileName.endsWith('.tsx')) &&
    !fileName.endsWith('.d.ts') &&
    !fileName.endsWith('.d.tsx')
  );
}

function checkFileLimits(filePath: string): void {
  const content = fs.readFileSync(filePath, 'utf8');
  const lineCount = content.split(/\r?\n/).length;
  const relativePath = path.relative(path.join(projectRoot, '..'), filePath);

  if (lineCount > FILE_ERROR_LINES) {
    violations.push({
      level: 'error',
      message: `${relativePath} has ${lineCount} lines (error > ${FILE_ERROR_LINES})`,
    });
  } else if (lineCount > FILE_WARN_LINES) {
    violations.push({
      level: 'warn',
      message: `${relativePath} has ${lineCount} lines (warn > ${FILE_WARN_LINES})`,
    });
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  visitFunctions(sourceFile, relativePath);
}

function visitFunctions(sourceFile: ts.SourceFile, relativePath: string): void {
  const queue: ts.Node[] = [sourceFile];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    if (isFunctionWithBody(current)) {
      recordFunctionLength(current, sourceFile, relativePath);
    }

    current.forEachChild((child) => {
      queue.push(child);
    });
  }
}

function isFunctionWithBody(
  node: ts.Node,
): node is ts.FunctionLikeDeclarationBase & { body: ts.Block } {
  return (
    ts.isFunctionLike(node) &&
    node.body !== undefined &&
    ts.isBlock(node.body as ts.Node)
  );
}

function recordFunctionLength(
  node: ts.FunctionLikeDeclarationBase & { body: ts.Block },
  sourceFile: ts.SourceFile,
  relativePath: string,
): void {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  const functionLines = end.line - start.line + 1;
  const functionName = getFunctionName(node);

  if (functionLines > FUNCTION_ERROR_LINES) {
    violations.push({
      level: 'error',
      message: `${relativePath} :: ${functionName} is ${functionLines} lines (error > ${FUNCTION_ERROR_LINES})`,
    });
  } else if (functionLines > FUNCTION_WARN_LINES) {
    violations.push({
      level: 'warn',
      message: `${relativePath} :: ${functionName} is ${functionLines} lines (warn > ${FUNCTION_WARN_LINES})`,
    });
  }
}

function getFunctionName(node: ts.FunctionLikeDeclarationBase): string {
  const name = ts.getNameOfDeclaration(node);
  if (name && ts.isIdentifier(name)) {
    return name.text;
  }

  return '<anonymous>';
}

const logger = getLogger('nui:check-limits');

function reportViolations(results: Violation[]): void {
  const errors = results.filter((violation) => violation.level === 'error');

  for (const violation of results) {
    if (violation.level === 'error') {
      logger.error(violation.message);
    } else {
      logger.warn(violation.message);
    }
  }

  if (errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  if (results.length === 0) {
    logger.log('limit checks passed');
  }
}

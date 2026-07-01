/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tree-sitter based shell command parser.
 *
 * Provides accurate shell syntax parsing for:
 * - Command substitution detection ($(), ``, <())
 * - Pipeline and command list splitting (&&, ||, ;, |)
 * - Command name extraction from complex commands
 *
 * Falls back gracefully to regex parsing if tree-sitter fails to initialize.
 */

import type {
  Parser as ParserType,
  Language,
  Tree,
  Node,
  Query as QueryType,
} from 'web-tree-sitter';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DebugLogger } from '../debug/DebugLogger.js';

const require = createRequire(import.meta.url);
const debugLogger = new DebugLogger('llxprt:shell-parser');

const PARSE_TIMEOUT_MICROS = 1000 * 1000; // 1 second

/**
 * Shape of the dynamically imported `web-tree-sitter` module. In 0.25.x the
 * `Parser` and `Language` classes are top-level named exports; some bundler
 * configurations also nest `Parser` under `default`.
 */
type TreeSitterLanguageLoader = {
  load(input: Uint8Array): Promise<Language>;
};

type TreeSitterDefaultExport =
  | {
      Parser?: new () => ParserType;
      Language?: TreeSitterLanguageLoader;
    }
  | (new () => ParserType);

interface TreeSitterModule {
  Parser?: new () => ParserType;
  Language?: TreeSitterLanguageLoader;
  default?: TreeSitterDefaultExport;
}

/**
 * Resolve the tree-sitter Parser constructor. web-tree-sitter's export shape
 * varies between bundler/runtime configurations: the Parser may be a named
 * export, nested under `default`, or be the module default itself.
 */
function resolveTreeSitterParser(
  named: unknown,
  defaultExport: unknown,
  fallback: unknown,
): unknown {
  if (typeof named === 'function') {
    return named;
  }
  if (typeof defaultExport === 'function') {
    return defaultExport;
  }
  return fallback;
}

type ObjectOrFunction = object | ((...args: never[]) => unknown);

function isObjectOrFunction(value: unknown): value is ObjectOrFunction {
  if (value === null) {
    return false;
  }
  const valueType = typeof value;
  return valueType === 'object' || valueType === 'function';
}

function isLanguageLoader(value: unknown): value is TreeSitterLanguageLoader {
  if (!isObjectOrFunction(value)) {
    return false;
  }
  if (!('load' in value)) {
    return false;
  }
  return typeof value.load === 'function';
}

function resolveTreeSitterLanguage(
  named: unknown,
  defaultExport: unknown,
): TreeSitterLanguageLoader | undefined {
  if (isLanguageLoader(named)) {
    return named;
  }
  if (
    typeof defaultExport === 'object' &&
    defaultExport !== null &&
    'Language' in defaultExport
  ) {
    const nestedLanguage = defaultExport.Language;
    if (isLanguageLoader(nestedLanguage)) {
      return nestedLanguage;
    }
  }
  return undefined;
}

/**
 * Resolve the bash grammar WASM bytes.
 *
 * The grammar is read from disk so the parser works under every runtime that
 * loads this module (raw Bun, plain Node, and vitest) without depending on a
 * build-time plugin. It is resolved from the package graph via
 * `require.resolve('tree-sitter-bash/tree-sitter-bash.wasm')`, which covers
 * source, dev, and npm-installed package layouts.
 *
 * esbuild's `?binary` import suffix was the previous mechanism; it has been
 * retired along with the esbuild bundling step, leaving these portable
 * filesystem paths.
 */
async function resolveBashWasmBytes(): Promise<Uint8Array> {
  const wasmPath = require.resolve('tree-sitter-bash/tree-sitter-bash.wasm');
  return new Uint8Array(readFileSync(wasmPath));
}

// Type definitions for tree-sitter query results
interface QueryCapture {
  name: string;
  node: Node;
}

interface QueryMatch {
  pattern: number;
  captures: QueryCapture[];
}

let parser: ParserType | null = null;
let bashLanguage: Language | null = null;
let initializationAttempted = false;
let initializationError: Error | null = null;

/**
 * Get the initialization error, if any.
 * Useful for debugging why tree-sitter failed to load.
 */
export function getInitializationError(): Error | null {
  return initializationError;
}

/**
 * Initialize the tree-sitter parser with bash language support.
 * Returns true if initialization succeeded, false otherwise.
 * Safe to call multiple times - will return cached result.
 */
export async function initializeParser(): Promise<boolean> {
  if (parser && bashLanguage) {
    return true;
  }

  if (initializationAttempted) {
    return parser !== null;
  }

  initializationAttempted = true;

  try {
    const TreeSitter = (await import('web-tree-sitter')) as TreeSitterModule;
    const parserCandidate = TreeSitter.Parser;
    const defaultCandidate = TreeSitter.default;
    const Parser = resolveTreeSitterParser(
      parserCandidate,
      defaultCandidate,
      TreeSitter,
    ) as (new () => ParserType) & { init(): Promise<void> };

    await Parser.init();
    parser = new Parser();

    const LanguageLoader = resolveTreeSitterLanguage(
      TreeSitter.Language,
      TreeSitter.default,
    );
    if (!LanguageLoader) {
      throw new Error(
        'web-tree-sitter Language export not found; expected top-level or default-nested Language.load()',
      );
    }

    const wasmBytes = await resolveBashWasmBytes();
    bashLanguage = await LanguageLoader.load(wasmBytes);
    parser.setLanguage(bashLanguage);

    return true;
  } catch (error) {
    initializationError =
      error instanceof Error ? error : new Error(String(error));
    parser = null;
    bashLanguage = null;
    return false;
  }
}

/**
 * Check if the tree-sitter parser is available.
 */
export function isParserAvailable(): boolean {
  return parser !== null && bashLanguage !== null;
}

/**
 * Parse a shell command string and return the syntax tree.
 * Returns null if parser is not available, the command is empty, or parsing
 * times out (default 1 s). Callers that receive null should either fall back
 * to regex parsing or reject the command outright.
 */
export function parseShellCommand(
  command: string,
  timeoutMicros: number = PARSE_TIMEOUT_MICROS,
): Tree | null {
  if (!parser || !command.trim()) {
    return null;
  }

  const deadline = performance.now() + timeoutMicros / 1000;
  const parseState = { timedOut: false };

  try {
    const tree = parser.parse(command, null, {
      progressCallback: () => {
        if (performance.now() > deadline) {
          parseState.timedOut = true;
          return true;
        }
        return undefined;
      },
    });

    if (parseState.timedOut) {
      debugLogger.error('Bash command parsing timed out for command:', command);
      // A cancelled parse leaves the parser in a resume state; reset so the
      // next parse starts fresh rather than resuming the cancelled command.
      parser.reset();
      return null;
    }

    return tree;
  } catch {
    return null;
  }
}

/**
 * Extract all command names from a parsed shell command tree.
 * This handles pipelines, command lists (&&, ||, ;), and subshells.
 */
export function extractCommandNames(tree: Tree): string[] {
  if (!bashLanguage) {
    return [];
  }

  const commands: string[] = [];

  // Query for command_name nodes which are the actual command being executed
  const query = bashLanguage.query('(command name: (command_name) @cmd)');
  try {
    const matches = query.matches(tree.rootNode) as QueryMatch[];

    for (const match of matches) {
      collectCommandNamesFromCaptures(match.captures, commands);
    }
  } finally {
    query.delete();
  }

  return commands;
}

function collectCommandNamesFromCaptures(
  captures: QueryMatch['captures'],
  commands: string[],
): void {
  for (const capture of captures) {
    if (capture.name !== 'cmd') {
      continue;
    }
    const cmdText = capture.node.text;
    const cmdName = cmdText.split(/[\\/]/).pop();
    if (cmdName) {
      commands.push(cmdName);
    }
  }
}

/**
 * Parsed command detail containing the command name and full text.
 */
export interface ParsedCommandDetail {
  name: string;
  text: string;
}

/**
 * Result of parsing command details.
 */
export interface CommandParseResult {
  details: ParsedCommandDetail[];
  hasError: boolean;
}

function hasShellSubstitutionSyntax(command: string): boolean {
  let inSingleQuotes = false;
  let inDoubleQuotes = false;
  let skipCurrent = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];
    if (skipCurrent) {
      skipCurrent = false;
    } else if (char === '\\' && !inSingleQuotes) {
      skipCurrent = true;
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
    } else if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
    } else if (
      !inSingleQuotes &&
      isShellSubstitutionStart(command, i, inDoubleQuotes)
    ) {
      return true;
    }
  }
  return false;
}

function isShellSubstitutionStart(
  command: string,
  index: number,
  inDoubleQuotes: boolean,
): boolean {
  return (
    isCommandSubstitutionStart(command, index) ||
    isProcessSubstitutionStart(command, index, inDoubleQuotes) ||
    command[index] === '`'
  );
}

function isCommandSubstitutionStart(command: string, index: number): boolean {
  if (command[index] !== '$') {
    return false;
  }
  if (command[index + 1] !== '(') {
    return false;
  }
  // Exclude arithmetic expansion $(( )) which is not command substitution
  if (index + 2 < command.length && command[index + 2] === '(') {
    return false;
  }
  return true;
}

function isProcessSubstitutionStart(
  command: string,
  index: number,
  inDoubleQuotes: boolean,
): boolean {
  if (inDoubleQuotes) {
    return false;
  }
  return (
    isProcessSubstitutionOperator(command[index]) &&
    index + 1 < command.length &&
    command[index + 1] === '('
  );
}

function isProcessSubstitutionOperator(char: string | undefined): boolean {
  return char === '<' || char === '>';
}

/**
 * Normalize a command name by removing quotes and extracting the base name.
 */
function normalizeCommandName(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

/**
 * Extract command name from a tree-sitter node.
 * Handles different node types: command, declaration_command, unset_command, test_command.
 */
function extractNameFromNode(node: Node): string | null {
  switch (node.type) {
    case 'command': {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) {
        return null;
      }
      return normalizeCommandName(nameNode.text);
    }
    case 'declaration_command':
    case 'unset_command':
    case 'test_command': {
      const firstChild = node.child(0);
      if (!firstChild) {
        return null;
      }
      return normalizeCommandName(firstChild.text);
    }
    default:
      return null;
  }
}

/**
 * Collect all command details from a tree by walking the entire AST.
 * This includes commands inside command substitutions ($(), ``), process substitutions (<(), >()),
 * function bodies, subshells, and any other nested contexts.
 *
 * This is essential for security - we need to validate ALL commands that will execute,
 * not just top-level commands.
 */
export function collectCommandDetails(
  tree: Tree,
  source: string,
): ParsedCommandDetail[] {
  const stack: Node[] = [tree.rootNode];
  const details: ParsedCommandDetail[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const commandName = extractNameFromNode(current);
    if (commandName) {
      details.push({
        name: commandName,
        text: source.slice(current.startIndex, current.endIndex).trim(),
      });
    }

    // Push children in reverse order so we process them left-to-right
    for (let i = current.namedChildCount - 1; i >= 0; i -= 1) {
      const child = current.namedChild(i);
      if (child) {
        stack.push(child);
      }
    }
  }

  return details;
}

/**
 * Check if a tree contains prompt command transformations like ${variable@P}.
 *
 * The `@P` transform performs prompt-string expansion: the variable's value is
 * interpreted as a PS1/PS2/PS4 prompt string, which can itself contain command
 * substitutions (`$(...)`, backticks), escape sequences, and other expansions.
 * This means an attacker who controls a variable value can execute arbitrary
 * commands via `${attacker_controlled@P}` — even if the surrounding command
 * appears harmless.  Detection here causes the command to be hard-denied.
 */
export function hasPromptCommandTransform(root: Node): boolean {
  const stack: Node[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (
      current.type === 'expansion' &&
      hasPromptTransformInExpansion(current)
    ) {
      return true;
    }

    for (let i = current.namedChildCount - 1; i >= 0; i -= 1) {
      const child = current.namedChild(i);
      if (child) {
        stack.push(child);
      }
    }
  }

  return false;
}

function hasPromptTransformInExpansion(node: Node): boolean {
  for (let i = 0; i < node.childCount - 1; i += 1) {
    const operatorNode = node.child(i);
    const transformNode = node.child(i + 1);
    if (operatorNode?.text === '@' && transformNode?.text === 'P') {
      return true;
    }
  }
  return false;
}

/**
 * Parse a shell command and extract all command details including nested commands.
 * Returns null if parsing fails or tree-sitter is not available.
 */
export function parseCommandDetails(
  command: string,
): CommandParseResult | null {
  if (!parser || !bashLanguage) {
    return null;
  }

  try {
    const tree = parseShellCommand(command);
    if (!tree) {
      return { details: [], hasError: true };
    }

    const details = collectCommandDetails(tree, command);

    // Check for syntax errors, empty command list, dangerous prompt transformations,
    // or substitution syntax that the grammar failed to expose as executable commands.
    const hasMissingSubstitutionDetails =
      hasShellSubstitutionSyntax(command) && !hasCommandSubstitution(tree);
    const hasError =
      tree.rootNode.hasError ||
      details.length === 0 ||
      hasPromptCommandTransform(tree.rootNode) ||
      hasMissingSubstitutionDetails;

    if (hasError) {
      let query: QueryType | null = null;
      try {
        query = bashLanguage.query('(ERROR) @error (MISSING) @missing');
        const captures = query.captures(tree.rootNode) as QueryCapture[];
        const syntaxErrors = captures.map((capture) => {
          const { node, name } = capture;
          const type = name === 'missing' ? 'Missing' : 'Error';
          return `${type} node: "${node.text}" at ${node.startPosition.row}:${node.startPosition.column}`;
        });

        debugLogger.log(
          'Bash command parsing error detected for command:',
          command,
          'Syntax Errors:',
          syntaxErrors,
        );
      } catch {
        // AST query failed - ignore syntax error detection
      } finally {
        query?.delete();
      }
    }

    return { details, hasError };
  } catch {
    return null;
  }
}

/**
 * Check if a command contains command substitution patterns.
 * Uses tree-sitter AST to accurately detect:
 * - $() command substitution
 * - `` backtick substitution
 * - <() process substitution
 */
export function hasCommandSubstitution(tree: Tree): boolean {
  if (!bashLanguage) {
    return false;
  }

  // Query for command_substitution and process_substitution nodes
  const query = bashLanguage.query(`
    [
      (command_substitution) @sub
      (process_substitution) @proc
    ]
  `);

  try {
    const matches = query.matches(tree.rootNode) as QueryMatch[];
    return matches.length > 0;
  } finally {
    query.delete();
  }
}

/**
 * Options for splitCommandsWithTree function.
 */
export interface SplitCommandsTreeOptions {
  /**
   * Whether to split on pipe operators (|).
   * Default: true (split pipes for security checks).
   *
   * Originally added for now-removed command instrumentation (PR #1546);
   * retained because it is zero-cost, tested, and useful for future
   * pipeline-aware display. Security validation always uses the default
   * (true) so every pipeline stage is validated individually.
   */
  splitOnPipes?: boolean;
}

/**
 * Split a command string into individual commands respecting shell syntax.
 * Handles &&, ||, ;. Pipe splitting is controlled by options.
 * @param tree The parsed tree-sitter tree
 * @param options Optional settings for split behavior
 */
export function splitCommandsWithTree(
  tree: Tree,
  options?: SplitCommandsTreeOptions,
): string[] {
  const splitOnPipes = options?.splitOnPipes ?? true;
  const commands: string[] = [];

  extractCommands(tree.rootNode, commands, splitOnPipes);
  return commands.filter((cmd) => cmd.trim().length > 0);
}

function extractCommands(
  node: Node,
  commands: string[],
  splitOnPipes: boolean,
): void {
  switch (node.type) {
    case 'command':
    case 'subshell':
      commands.push(node.text);
      break;
    case 'pipeline':
      if (splitOnPipes) {
        // Recurse into pipeline children to get individual commands
        for (const child of node.children.filter(isNode)) {
          extractCommands(child, commands, splitOnPipes);
        }
      } else {
        // Treat pipeline as atomic for instrumentation
        commands.push(node.text);
      }
      break;
    case 'list':
    // Lists are command chains (&&, ||, ;) - recurse into children
    // falls through to program/default
    case 'program':
    default:
      // For other node types (and program), check children
      for (const child of node.children.filter(isNode)) {
        extractCommands(child, commands, splitOnPipes);
      }
      break;
  }
}

/**
 * Reset the parser state (primarily for testing).
 */
export function resetParser(): void {
  parser = null;
  bashLanguage = null;
  initializationAttempted = false;
  initializationError = null;
}

function isNode(node: Node | null): node is Node {
  return node !== null;
}

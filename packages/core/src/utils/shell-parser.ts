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
} from 'web-tree-sitter';

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
    // Dynamic import to get the Parser class
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TreeSitter = (await import('web-tree-sitter')) as any;
    const Parser = TreeSitter.default || TreeSitter;

    await Parser.init();
    parser = new Parser();

    // Load the bash language WASM
    // The ?binary suffix triggers our esbuild plugin to embed the wasm
    const wasmModule = await import(
      'tree-sitter-bash/tree-sitter-bash.wasm?binary'
    );
    bashLanguage = await Parser.Language.load(wasmModule.default);
    parser!.setLanguage(bashLanguage);

    return true;
  } catch (error) {
    initializationError =
      error instanceof Error ? error : new Error(String(error));
    // Use debug logging instead of console.warn to avoid polluting output
    // The fallback to regex is seamless and doesn't need user notification
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
 * Returns null if parser is not available.
 */
export function parseShellCommand(command: string): Tree | null {
  if (!parser) {
    return null;
  }
  return parser.parse(command);
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
  const matches = query.matches(tree.rootNode) as QueryMatch[];

  for (const match of matches) {
    for (const capture of match.captures) {
      if (capture.name === 'cmd') {
        const cmdText = capture.node.text;
        // Extract just the command name (last path component if it's a path)
        const cmdName = cmdText.split(/[\\/]/).pop();
        if (cmdName) {
          commands.push(cmdName);
        }
      }
    }
  }

  return commands;
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

  const matches = query.matches(tree.rootNode) as QueryMatch[];
  return matches.length > 0;
}

/**
 * Split a command string into individual commands respecting shell syntax.
 * Handles &&, ||, ;, |, and properly ignores these inside quotes.
 */
export function splitCommandsWithTree(tree: Tree): string[] {
  const commands: string[] = [];

  function extractCommands(node: Node): void {
    switch (node.type) {
      case 'command':
      case 'subshell':
        commands.push(node.text);
        break;
      case 'pipeline':
      case 'list':
        // Recurse into children
        for (const child of node.children) {
          if (child) extractCommands(child);
        }
        break;
      case 'program':
        for (const child of node.children) {
          if (child) extractCommands(child);
        }
        break;
      default:
        // For other node types, check children
        for (const child of node.children) {
          if (child) extractCommands(child);
        }
    }
  }

  extractCommands(tree.rootNode);
  return commands.filter((cmd) => cmd.trim().length > 0);
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

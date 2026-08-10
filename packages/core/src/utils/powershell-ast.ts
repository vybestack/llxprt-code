/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PowerShell AST extraction and security classification (#3181).
 *
 * Extracted from shell-parser.ts to keep that module within line limits.
 * All public entry points are consumed by shell-parser.ts's language-aware
 * dispatchers; this module holds no parser lifecycle state and relies on
 * the caller to provide a recursion callback for nested-payload parsing.
 */

import type { Tree, Node } from 'web-tree-sitter';
import type {
  ParsedCommandDetail,
  CommandParseResult,
  ParserLanguage,
  SplitCommandsTreeOptions,
} from './shell-parser.js';
import { extractPwshWrapperPayloadDetails } from './powershell-wrapper-payload.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Recursion callback used to parse a nested wrapper payload with the
 * appropriate grammar. Provided by shell-parser.ts to avoid a circular
 * module dependency.
 */
export type ParsePayloadFn = (
  payload: string,
  language: ParserLanguage,
) => CommandParseResult | null;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const START_PROCESS_PARAMETERS = [
  'argumentlist',
  'confirm',
  'credential',
  'debug',
  'environment',
  'erroraction',
  'errorvariable',
  'filepath',
  'informationaction',
  'informationvariable',
  'loaduserprofile',
  'nonewwindow',
  'outbuffer',
  'outvariable',
  'passthru',
  'pipelinevariable',
  'progressaction',
  'redirectstandarderror',
  'redirectstandardinput',
  'redirectstandardoutput',
  'usenewenvironment',
  'verb',
  'verbose',
  'wait',
  'warningaction',
  'warningvariable',
  'whatif',
  'windowstyle',
  'workingdirectory',
] as const;
const START_PROCESS_SWITCHES = new Set<string>([
  'confirm',
  'debug',
  'loaduserprofile',
  'nonewwindow',
  'passthru',
  'usenewenvironment',
  'verbose',
  'wait',
  'whatif',
]);

/**
 * Node types that represent dynamic (unresolvable) content and must never
 * yield a static fragment through direct traversal. Listed explicitly so the
 * contract is resilient to grammar changes (Finding 4, #3181).
 */
const DYNAMIC_BOUNDARY_TYPES = new Set<string>([
  'variable',
  'sub_expression',
  'array_literal',
  'expandable_string_literal',
  'expandable_here_string_literal',
]);

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function findNamedChild(node: Node, type: string): Node | null {
  for (let index = 0; index < node.namedChildCount; index += 1) {
    const child = node.namedChild(index);
    if (child?.type === type) {
      return child;
    }
  }
  return null;
}

export function expressionDetail(text: string): ParsedCommandDetail {
  return { name: '', text, nameKind: 'expression' };
}

function dynamicDetail(text: string): ParsedCommandDetail {
  return { name: '', text, nameKind: 'dynamic' };
}

function resolveStartProcessParameter(raw: string): string | null {
  const fragment = raw.replace(/^-+/u, '').split(':', 1)[0]?.toLowerCase();
  if (!fragment) {
    return null;
  }
  const matches = START_PROCESS_PARAMETERS.filter((name) =>
    name.startsWith(fragment),
  );
  return matches.length === 1 ? matches[0] : null;
}

// ---------------------------------------------------------------------------
// Command splitting
// ---------------------------------------------------------------------------

export function splitPwshCommandsWithTree(
  tree: Tree,
  options?: SplitCommandsTreeOptions,
): string[] {
  const splitOnPipes = options?.splitOnPipes ?? true;
  const commands: string[] = [];

  splitPwshCommands(tree.rootNode, commands, splitOnPipes);
  return commands.filter((cmd) => cmd.trim().length > 0);
}

function splitPwshCommands(
  node: Node,
  commands: string[],
  splitOnPipes: boolean,
): void {
  switch (node.type) {
    case 'command':
      commands.push(node.text);
      break;
    case 'pipeline':
      if (splitOnPipes) {
        for (const child of node.children.filter(isNode)) {
          splitPwshCommands(child, commands, splitOnPipes);
        }
      } else {
        commands.push(node.text);
      }
      break;
    default:
      for (const child of node.children.filter(isNode)) {
        splitPwshCommands(child, commands, splitOnPipes);
      }
      break;
  }
}

function isNode(node: Node | null): node is Node {
  return node !== null;
}

// ---------------------------------------------------------------------------
// Command detail collection (recursive AST walk)
// ---------------------------------------------------------------------------

/**
 * Walk the PowerShell AST collecting all command details, recursing into
 * script blocks, subexpressions, arrays, and control flow.
 */
export function collectPwshCommandDetailsFromTree(
  tree: Tree,
  source: string,
  parsePayload: ParsePayloadFn,
): ParsedCommandDetail[] {
  const details: ParsedCommandDetail[] = [];
  const stack: Node[] = [tree.rootNode];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.type === 'command') {
      const detail = extractPwshCommandDetail(current, source);
      if (detail) {
        details.push(detail);
      }

      // Expand wrapper/evaluator payloads (Finding 4, #3181).
      // Literal payloads are recursively parsed with the target grammar;
      // dynamic payloads are classified as unresolved expressions.
      details.push(
        ...extractPwshWrapperPayloadDetails(current, source, parsePayload),
      );
    }

    // Classify EVERY executable invocation_expression (instance method,
    // static method, .NET member call, etc.) as an unresolved expression
    // target. These cannot be statically matched against command allowlists
    // and must fail closed in restricted policy (Finding 2, #3181).
    if (current.type === 'invocation_expression') {
      details.push(
        expressionDetail(
          source.slice(current.startIndex, current.endIndex).trim(),
        ),
      );
    }

    for (let i = current.namedChildCount - 1; i >= 0; i -= 1) {
      const child = current.namedChild(i);
      if (child) {
        stack.push(child);
      }
    }
  }

  return details;
}

// ---------------------------------------------------------------------------
// Single-command extraction
// ---------------------------------------------------------------------------

function extractPwshCommandDetail(
  commandNode: Node,
  source: string,
): ParsedCommandDetail | null {
  const text = source
    .slice(commandNode.startIndex, commandNode.endIndex)
    .trim();

  // Case 1: simple command_name child (Get-ChildItem, git, etc.)
  for (let i = 0; i < commandNode.namedChildCount; i += 1) {
    const child = commandNode.namedChild(i);
    if (child?.type === 'command_name') {
      const name = normalizePwshCommandName(child.text);
      if (name !== child.text.trim()) {
        return buildPwshStaticInvocationDetail(
          name,
          child,
          commandNode,
          source,
          text,
        );
      }
      return { name, text, nameKind: 'static' };
    }
  }

  // Case 2: call/dot operator invocation (& "path", . .\script.ps1)
  const invocation = findInvocationOperatorTarget(commandNode);
  if (invocation) {
    return classifyPwshInvocationTarget(invocation, commandNode, source, text);
  }

  return null;
}

/**
 * Find the command_name_expr paired with a command_invocation_operator.
 */
function findInvocationOperatorTarget(commandNode: Node): Node | null {
  let hasInvocationOperator = false;
  let nameExprNode: Node | null = null;

  for (let i = 0; i < commandNode.childCount; i += 1) {
    const child = commandNode.child(i);
    if (!child) {
      continue;
    }
    if (child.type === 'command_invocation_operator') {
      hasInvocationOperator = true;
    } else if (child.type === 'command_name_expr') {
      nameExprNode = child;
    }
  }

  return hasInvocationOperator ? nameExprNode : null;
}

export function getPwshCommandName(commandNode: Node): string | null {
  for (let i = 0; i < commandNode.namedChildCount; i += 1) {
    const child = commandNode.namedChild(i);
    if (child?.type === 'command_name') {
      return child.text.toLowerCase();
    }
  }

  const invocationTarget = findInvocationOperatorTarget(commandNode);
  if (!invocationTarget) {
    return null;
  }

  for (let i = 0; i < invocationTarget.namedChildCount; i += 1) {
    const child = invocationTarget.namedChild(i);
    if (child?.type === 'command_name') {
      return normalizePwshCommandName(child.text).toLowerCase();
    }
    if (child?.type === 'string_literal') {
      const literal = extractPwshStaticStringContent(child);
      return literal === null
        ? null
        : normalizePwshCommandName(literal).toLowerCase();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// String argument extraction
// ---------------------------------------------------------------------------

export function extractPwshStaticStringDescendant(node: Node): string | null {
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.type === 'string_literal') {
      return extractPwshStaticStringContent(current);
    }

    // Explicit dynamic boundaries: a bare expandable string (with or without
    // interpolation) or any variable/subexpression/array must never yield a
    // static fragment through direct traversal. In the current grammar these
    // are always children of string_literal (handled above), but marking them
    // explicitly makes the contract resilient to grammar changes.
    if (DYNAMIC_BOUNDARY_TYPES.has(current.type)) {
      return null;
    }

    for (let i = current.namedChildCount - 1; i >= 0; i -= 1) {
      const child = current.namedChild(i);
      if (child) {
        stack.push(child);
      }
    }
  }
  return null;
}

function extractPwshStaticStringContent(stringNode: Node): string | null {
  for (let i = 0; i < stringNode.namedChildCount; i += 1) {
    const child = stringNode.namedChild(i);
    if (!child) {
      continue;
    }

    if (
      child.type === 'verbatim_string_characters' ||
      child.type === 'verbatim_here_string_characters'
    ) {
      return extractPwshStringLiteralText(child.text);
    }

    if (
      child.type === 'expandable_string_literal' ||
      child.type === 'expandable_here_string_literal'
    ) {
      if (child.namedChildCount > 0) {
        return null;
      }
      return extractPwshStringLiteralText(child.text);
    }
  }
  return extractPwshStringLiteralText(stringNode.text);
}

// ---------------------------------------------------------------------------
// Process launcher (Start-Process) target extraction
// ---------------------------------------------------------------------------

/**
 * Extract the target executable from a Start-Process / saps command node.
 * The first positional argument or the -FilePath parameter value is the
 * target. Literal string targets and bare tokens are classified as `static`;
 * variable/subexpression targets are classified as `dynamic` (Finding 4, #3181).
 */
export function extractPwshLauncherTarget(
  commandNode: Node,
): ParsedCommandDetail | null {
  const commandElements = findNamedChild(commandNode, 'command_elements');
  if (!commandElements) {
    return null;
  }

  const children = Array.from(
    { length: commandElements.namedChildCount },
    (_, index) => commandElements.namedChild(index),
  ).filter((child): child is Node => child !== null);

  const explicit = findExplicitFilePathTarget(children);
  return explicit ?? findFirstPositionalLauncherTarget(children);
}

function findExplicitFilePathTarget(
  children: readonly Node[],
): ParsedCommandDetail | null {
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (
      child.type !== 'command_parameter' ||
      resolveStartProcessParameter(child.text) !== 'filepath'
    ) {
      continue;
    }
    const result = findFilePathValue(children, index + 1);
    if (result) {
      return result;
    }
  }
  return null;
}

function findFilePathValue(
  children: readonly Node[],
  startIndex: number,
): ParsedCommandDetail | null {
  for (
    let valueIndex = startIndex;
    valueIndex < children.length;
    valueIndex += 1
  ) {
    const value = children[valueIndex];
    if (value.type === 'command_parameter') {
      return null;
    }
    const classified = classifyPwshLauncherArgument(value);
    if (classified) {
      return classified;
    }
  }
  return null;
}

function findFirstPositionalLauncherTarget(
  children: readonly Node[],
): ParsedCommandDetail | null {
  let skipParameterValue = false;
  for (const child of children) {
    if (child.type === 'command_argument_sep') {
      // Separators do not consume the value expected by a preceding parameter.
    } else if (child.type === 'command_parameter') {
      const parameter = resolveStartProcessParameter(child.text);
      skipParameterValue =
        parameter === null || !START_PROCESS_SWITCHES.has(parameter);
    } else {
      const shouldSkip = skipParameterValue;
      skipParameterValue = false;
      const classified = shouldSkip
        ? null
        : classifyPwshLauncherArgument(child);
      if (classified !== null) {
        return classified;
      }
    }
  }
  return null;
}

function classifyPwshLauncherArgument(arg: Node): ParsedCommandDetail | null {
  if (arg.type === 'generic_token') {
    return {
      name: normalizePwshCommandName(arg.text),
      text: arg.text,
      nameKind: 'static',
    };
  }

  if (arg.type === 'unary_expression') {
    return classifyUnaryExpressionArg(arg);
  }

  if (
    arg.type === 'variable' ||
    arg.type === 'sub_expression' ||
    arg.type === 'array_literal'
  ) {
    return dynamicDetail(arg.text);
  }

  return null;
}

function classifyUnaryExpressionArg(arg: Node): ParsedCommandDetail | null {
  for (let i = 0; i < arg.namedChildCount; i += 1) {
    const inner = arg.namedChild(i);
    if (!inner) {
      continue;
    }

    if (inner.type === 'string_literal') {
      const content = extractPwshStaticStringContent(inner);
      if (content !== null) {
        return {
          name: normalizePwshCommandName(content),
          text: content,
          nameKind: 'static',
        };
      }
      return dynamicDetail(arg.text);
    }

    if (inner.type === 'variable') {
      return dynamicDetail(arg.text);
    }
  }
  // Any other unary_expression content (parenthesized member access,
  // element access, string concatenation, nested invocation, etc.) cannot
  // resolve to a static command name. Classify it as dynamic so a strict
  // allowlist fails closed instead of skipping the target (#3181 review).
  return dynamicDetail(arg.text);
}

// ---------------------------------------------------------------------------
// Invocation target classification (& / . operator)
// ---------------------------------------------------------------------------

function classifyPwshInvocationTarget(
  nameExprNode: Node,
  commandNode: Node,
  source: string,
  text: string,
): ParsedCommandDetail {
  for (let i = 0; i < nameExprNode.namedChildCount; i += 1) {
    const inner = nameExprNode.namedChild(i);
    if (!inner) {
      continue;
    }

    if (inner.type === 'string_literal' && !hasExpandableChild(inner)) {
      const resolvedName = normalizePwshCommandName(
        extractPwshStringLiteralText(inner.text),
      );
      // An empty target like & '' cannot resolve to a safe static name.
      // Classify as dynamic so strict allowlist fails closed (#3181).
      if (!resolvedName) {
        return dynamicDetail(text);
      }
      return buildPwshStaticInvocationDetail(
        resolvedName,
        nameExprNode,
        commandNode,
        source,
        text,
      );
    }

    if (inner.type === 'string_literal' && hasExpandableChild(inner)) {
      return dynamicDetail(text);
    }

    if (inner.type === 'command_name') {
      return buildPwshStaticInvocationDetail(
        normalizePwshCommandName(inner.text),
        nameExprNode,
        commandNode,
        source,
        text,
      );
    }

    return dynamicDetail(text);
  }

  return dynamicDetail(text);
}

function hasExpandableChild(node: Node): boolean {
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child?.type === 'expandable_string_literal') {
      return child.namedChildCount > 0;
    }
  }
  return false;
}

function buildPwshStaticInvocationDetail(
  name: string,
  nameExprNode: Node,
  commandNode: Node,
  source: string,
  text: string,
): ParsedCommandDetail {
  const argsText = source
    .slice(nameExprNode.endIndex, commandNode.endIndex)
    .trim();
  const canonicalText = argsText ? `${name} ${argsText}` : name;
  return { name, text, canonicalText, nameKind: 'static' };
}

// ---------------------------------------------------------------------------
// Name normalization
// ---------------------------------------------------------------------------

function normalizePwshCommandName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

function extractPwshStringLiteralText(raw: string): string {
  if (raw.startsWith("@'") && raw.endsWith("'@")) {
    return stripPwshHereStringBoundaryNewlines(raw.slice(2, -2));
  }
  if (raw.startsWith('@"') && raw.endsWith('"@')) {
    return decodePwshDoubleQuotedContent(
      stripPwshHereStringBoundaryNewlines(raw.slice(2, -2)),
    );
  }
  if (raw.length < 2) {
    return raw;
  }

  const quote = raw[0];
  if ((quote !== '"' && quote !== "'") || raw[raw.length - 1] !== quote) {
    return raw;
  }

  const content = raw.slice(1, -1);
  return quote === "'"
    ? content.replace(/''/g, "'")
    : decodePwshDoubleQuotedContent(content);
}

function stripPwshHereStringBoundaryNewlines(content: string): string {
  return content
    .replace(/^(?:\r\n|\n|\r)/u, '')
    .replace(/(?:\r\n|\n|\r)$/u, '');
}

function decodePwshDoubleQuotedContent(content: string): string {
  const escapeValues: Readonly<Record<string, string>> = {
    '0': '\0',
    a: '\x07',
    b: '\b',
    e: '\x1b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
  };
  // Collapse doubled double-quotes FIRST ("" -> "). In PowerShell a literal "
  // inside a double-quoted string is escaped by doubling it. This must run
  // before backtick processing so a backtick-escaped quote (`") is never
  // accidentally merged with an adjacent quote by the collapse.
  const collapsed = content.replace(/""/g, '"');
  return collapsed.replace(/`(?:\r\n|[\s\S])/g, (escaped) => {
    const value = escaped.slice(1);
    if (value === '\r\n' || value === '\n' || value === '\r') {
      return '';
    }
    return escapeValues[value] ?? value;
  });
}

// ---------------------------------------------------------------------------
// Substitution detection and error diagnostics
// ---------------------------------------------------------------------------

/**
 * Detect `$()` subexpression nodes. PowerShell backticks are escapes, not
 * substitution (unlike Bash backticks).
 */
export function hasPwshCommandSubstitution(root: Node): boolean {
  const stack: Node[] = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    if (current.type === 'sub_expression') {
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

export function findFirstErrorNode(root: Node): Node | null {
  if (!root.hasError) {
    return null;
  }
  // tree-sitter represents missing tokens as nodes whose expected type is
  // preserved (e.g. 'command_name') with isMissing === true; the 'MISSING'
  // pseudo-type is never set on the node.type field.
  if (root.type === 'ERROR' || root.isMissing) {
    return root;
  }

  return findFirstErrorDescendant(root);
}

function findFirstErrorDescendant(root: Node): Node | null {
  for (let i = 0; i < root.childCount; i += 1) {
    const child = root.child(i);
    if (!child) {
      continue;
    }
    // findFirstErrorNode checks hasError internally and returns null
    // immediately for subtrees without errors.
    const found = findFirstErrorNode(child);
    if (found) {
      return found;
    }
  }
  return null;
}

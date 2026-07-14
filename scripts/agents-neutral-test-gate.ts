#!/usr/bin/env node
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Agents neutral test gate — bans @google/genai imports AND Google-shaped
 * structural fixtures (GenerateContentResponse identifiers/casts, candidates/
 * content/parts envelopes) in agents test files.
 *
 * Uses AST detection (not text grep) for precise, context-aware matching.
 * The ONLY exception is the named central allow-list
 * (dev-docs/agents-neutral-gate-allowlist.md) for characterization files
 * and the central neutral test-helpers bridge.
 *
 * @plan PLAN-20260707-AGENTNEUTRAL.P29/P31
 * @requirement REQ-012.3
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const ROOT = process.cwd();
const AGENTS_SRC = join(ROOT, 'packages', 'agents', 'src');

// ─── Extensions ─────────────────────────────────────────────────────────────

/** All test-file extensions discovered by the gate (Finding #4). */
const TEST_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
]);

// ─── Allow-list ─────────────────────────────────────────────────────────────

const ALLOWLIST_PATH = join(
  ROOT,
  'dev-docs',
  'agents-neutral-gate-allowlist.md',
);

interface TestAllowlistEntry {
  readonly file: string;
  readonly kind: string;
  readonly contextPattern: string;
}

/**
 * Parse the test-gate allow-list section from the markdown artifact.
 * Rows with subkind `test-genai-allow` or `test-structural-allow` name
 * files exempt from the respective checks.
 *
 * The contextPattern column (3rd) narrows structural exemptions to
 * specific AST contexts (e.g. `hook-wire`) so that only offenses inside
 * the named context are exempted, not entire files.
 */
export function parseTestAllowlist(path: string): TestAllowlistEntry[] {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf-8');
  const entries: TestAllowlistEntry[] = [];
  const dataRows = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|') && !line.includes('---'))
    .filter((line) => !(line.includes('File') && line.includes('Subkind')))
    .map((line) =>
      line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0),
    )
    .filter((cells) => cells.length >= 2);

  for (const cells of dataRows) {
    const file = cells[0].replace(/`/g, '');
    const subkind = cells[1].replace(/`/g, '');
    const contextPattern = cells.length >= 3 ? cells[2].replace(/`/g, '') : '';
    if (subkind === 'test-genai-allow' || subkind === 'test-structural-allow') {
      entries.push({ file, kind: subkind, contextPattern });
    }
  }
  return entries;
}

// ─── File discovery ─────────────────────────────────────────────────────────

/**
 * Recursively find all test/spec/helper files under a directory.
 *
 * Scans: .test/.spec files anywhere, test-helpers files anywhere, AND all
 * supported extension files inside any __tests__ directory (including
 * nested helpers that don't match the .test/.spec naming convention).
 *
 * Supports: .ts, .tsx, .js, .jsx, .mts, .cts (Finding #4).
 *
 * @plan PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement REQ-012.3
 */
export function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (isTestNamedFile(entry) || isTestHelperFile(entry)) {
      results.push(fullPath);
    } else if (
      fullPath.includes(`${sep}__tests__${sep}`) &&
      isSupportedTestExt(entry)
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

function isSupportedTestExt(entry: string): boolean {
  return TEST_EXTENSIONS.has(extname(entry));
}

function isTestNamedFile(entry: string): boolean {
  const ext = extname(entry);
  if (!TEST_EXTENSIONS.has(ext)) return false;
  const base = entry.slice(0, entry.length - ext.length);
  return base.endsWith('.test') || base.endsWith('.spec');
}

function isTestHelperFile(entry: string): boolean {
  const ext = extname(entry);
  if (!TEST_EXTENSIONS.has(ext)) return false;
  return /test-helpers?$/.test(entry.slice(0, entry.length - ext.length));
}

// ─── @google/genai import detection (AST-based — Finding #4) ───────────────

const GENAI_MODULE = '@google/genai';

/** Whether a module specifier string is @google/genai or a subpath. */
function isGenaiModule(spec: string): boolean {
  return spec === GENAI_MODULE || spec.startsWith('@google/genai/');
}

/** Whether a call expression's first argument is a @google/genai module string. */
function firstArgIsGenai(node: ts.CallExpression): boolean {
  return (
    node.arguments.length > 0 &&
    ts.isStringLiteral(node.arguments[0]) &&
    isGenaiModule(node.arguments[0].text)
  );
}

/** Whether a call expression is `import('@google/genai')` (dynamic import). */
function isDynamicGenaiImport(node: ts.CallExpression): boolean {
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    firstArgIsGenai(node)
  );
}

/** Whether a call expression is `require('@google/genai')` (CJS). */
function isGenaiRequire(node: ts.CallExpression): boolean {
  return (
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require' &&
    firstArgIsGenai(node)
  );
}

/**
 * AST-scan a source file for @google/genai imports/re-exports/dynamic
 * imports/require. Returns true if any are found.
 *
 * Replaces the old regex-based detection which missed export-from and
 * dynamic import(), and produced false positives on comments/strings.
 *
 * @plan PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement REQ-012.3
 */
function hasGenaiImport(sf: ts.SourceFile): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    // Static import: `import ... from '@google/genai'` or subpath
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec) && isGenaiModule(spec.text)) {
        found = true;
        return;
      }
    }
    // Re-export: `export ... from '@google/genai'` or subpath
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec) && isGenaiModule(spec.text)) {
        found = true;
        return;
      }
    }
    // Dynamic import: `import('@google/genai')` or CJS require or subpath
    if (
      ts.isCallExpression(node) &&
      (isDynamicGenaiImport(node) || isGenaiRequire(node))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return found;
}

/**
 * Scan test files for @google/genai imports (AST-based). Returns relative
 * paths of offenders. Detects import, export-from, dynamic import, and
 * require — comments and string literals are naturally excluded.
 *
 * @plan PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement REQ-012.3
 */
export function findGenaiOffenders(
  files: readonly string[],
  root: string,
): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const sf = parseSourceFile(file);
    if (sf !== null && hasGenaiImport(sf)) {
      offenders.push(relative(root, file));
    }
  }
  return offenders;
}

// ─── AST structural detection (Finding #3, REQ-012.3) ──────────────────────

/** Google response type names banned in agents tests. */
const BANNED_TEST_TYPE_NAMES: ReadonlySet<string> = new Set([
  'GenerateContentResponse',
  'GenerateContentResponseUsageMetadata',
]);

export interface StructuralOffense {
  readonly file: string;
  readonly line: number;
  readonly kind:
    | 'GCR-identifier'
    | 'GCR-type-ref'
    | 'GCR-cast'
    | 'candidates-envelope'
    | 'role-parts-envelope'
    | 'function-call-part'
    | 'function-response-part';
  readonly snippet: string;
  /** Enclosing named function/scope for context-aware allow-listing. */
  readonly enclosingFn: string | null;
  /** Whether the offense is inside a hookSpecificOutput.llm_response wire
   *  context (for hook-wire allow-listing). */
  readonly inHookWire: boolean;
  /** Whether the offense is passed as an argument to (or assigned to a
   *  variable consumed by) a named boundary converter function that
   *  explicitly accepts Google-shaped wire data as input and converts it
   *  to neutral IContent. Covers ContentConverters.toIContent,
   *  extractSystemInstructionText, convertToFunctionResponse,
   *  normalizeToolInteractionInput,
   *  createUserContentWithFunctionResponseFix, iContentFromLegacyInput. */
  readonly inConverterBoundary: boolean;
  /** Whether the offense is inside a file/scope that declares a local
   *  LegacyContent/LegacyPart type alias — legacy compatibility
   *  characterization tests exercising predicates against the legacy
   *  Google Part shape. */
  readonly inLegacyCompat: boolean;
  /** ALL enclosing test-block labels (it/describe/test), innermost first.
   *  Used for central allow-list matching — a fixture inside an `it()`
   *  inside a `describe()` carries both labels so allow-list entries can
   *  match at either level. */
  readonly enclosingTestLabels: readonly string[];
}

/**
 * AST-scan test files for banned Google-shaped structural fixtures:
 * - GenerateContentResponse identifiers, type references, and casts
 * - candidates/content/parts object-literal envelope fixtures
 *
 * Returns relative-path offenses. Filters each offense through the
 * AST-context allow-list: only offenses whose enclosing context matches
 * an allow-list entry's contextPattern are exempted. Files with a `*`
 * (wildcard) context pattern are fully exempted (backward compat).
 *
 * @plan PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement REQ-012.3
 */
export function findStructuralOffenders(
  files: readonly string[],
  root: string,
  allowlist: readonly TestAllowlistEntry[],
): StructuralOffense[] {
  const offenses: StructuralOffense[] = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, '/');
    const sf = parseSourceFile(file);
    if (sf === null) continue;
    const fileOffenses = scanForGoogleShapes(sf, rel);
    for (const offense of fileOffenses) {
      if (
        !isProvenanceExempt(offense) &&
        !isContextExempt(rel, offense, allowlist)
      ) {
        offenses.push(offense);
      }
    }
  }
  return offenses;
}

/**
 * Whether a structural offense is auto-exempted by provenance-aware boundary
 * detection — NO allow-list entry needed.
 *
 * This distinguishes true boundary wire characterization from internal
 * mock plumbing:
 *
 * - **Converter boundary**: the fixture is passed as an argument to a named
 *   boundary converter function (toIContent, extractSystemInstructionText,
 *   convertToFunctionResponse, etc.) that explicitly accepts Google-shaped
 *   wire data and converts it to neutral IContent.
 * - **Legacy compat**: the file declares local LegacyContent/LegacyPart/
 *   MockPart type aliases, characterizing the legacy Google Part shape.
 *
 * Unrelated fixtures in the same file that don't match any provenance
 * context are NOT exempted — this is per-offense, not per-file.
 */
function isProvenanceExempt(offense: StructuralOffense): boolean {
  return offense.inConverterBoundary || offense.inLegacyCompat;
}

/**
 * Whether a structural offense is exempted by the allow-list.
 *
 * Matches file (suffix) AND kind. If the entry has a wildcard context
 * pattern (`*` or empty), the entire file is exempted for that kind.
 * Otherwise the offense's AST context must match the entry's
 * contextPattern:
 *
 * - `hook-wire`: the offense must be inside the public hook
 *   `hookSpecificOutput.llm_response` wire context, or inside a named
 *   hook-wire adapter/characterization function. Unrelated candidate
 *   fixtures in the same file are NOT exempted.
 * - Otherwise: the pattern is matched against any enclosing test-block
 *   label (it/describe/test), the enclosing function name, or the snippet.
 *   This allows central allow-list entries to exempt legacy rejection
 *   tests by naming the describe/it block label exactly.
 */
function isContextExempt(
  relFile: string,
  offense: StructuralOffense,
  entries: readonly TestAllowlistEntry[],
): boolean {
  return entries.some((entry) => {
    if (entry.kind !== 'test-structural-allow') return false;
    if (!(relFile === entry.file || relFile.endsWith('/' + entry.file))) {
      return false;
    }
    const pattern = entry.contextPattern;
    // Wildcard: exempt entire file for this kind
    if (pattern === '' || pattern === '*' || pattern === undefined) return true;
    // hook-wire context: only exempt if offense is in hook-wire context
    if (pattern === 'hook-wire') return offense.inHookWire;
    // Test-block label match: check if ANY enclosing test block label
    // includes the pattern (allows describe-level exemptions to cover
    // nested it() fixtures).
    if (offense.enclosingTestLabels.some((label) => label.includes(pattern)))
      return true;
    // Generic context: check enclosing function name or snippet
    return offense.enclosingFn === pattern || offense.snippet.includes(pattern);
  });
}

function parseSourceFile(filePath: string): ts.SourceFile | null {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
  return ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForExt(filePath),
  );
}

function scriptKindForExt(filePath: string): ts.ScriptKind {
  const ext = extname(filePath);
  switch (ext) {
    case '.tsx':
      return ts.ScriptKind.TSX;
    case '.jsx':
      return ts.ScriptKind.JSX;
    case '.cts':
      return ts.ScriptKind.CTS;
    case '.mts':
      return ts.ScriptKind.MTS;
    case '.js':
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

function snippetOf(sf: ts.SourceFile, node: ts.Node): string {
  const start = node.getStart();
  return sf.text
    .slice(start, Math.min(start + 80, node.getEnd()))
    .replace(/\n/g, ' ')
    .trim();
}

function getLine(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * Walk a source file AST for banned Google-shaped constructs.
 *
 * Each offense carries AST context (enclosingFn, inHookWire,
 * inConverterBoundary, inLegacyCompat, inLegacyRejection) so the
 * allow-list can exempt only specific contexts, not entire files.
 */
function scanForGoogleShapes(
  sf: ts.SourceFile,
  rel: string,
): StructuralOffense[] {
  const offenses: StructuralOffense[] = [];
  function recordOffense(node: ts.Node, kind: StructuralOffense['kind']): void {
    offenses.push({
      file: rel,
      line: getLine(sf, node.getStart()),
      kind,
      snippet: snippetOf(sf, node),
      enclosingFn: enclosingFunctionName(node),
      inHookWire: isInHookWireContext(node),
      inConverterBoundary: isInConverterBoundary(node),
      inLegacyCompat: isInLegacyCompatScope(node),
      enclosingTestLabels: allEnclosingTestBlockLabels(node),
    });
  }
  function visit(node: ts.Node): void {
    // Type references: `x: GenerateContentResponse`
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      BANNED_TEST_TYPE_NAMES.has(node.typeName.text)
    ) {
      recordOffense(node, 'GCR-type-ref');
    }
    // Type assertions / as-expression: `x as GenerateContentResponse`
    if (
      ts.isAsExpression(node) &&
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      BANNED_TEST_TYPE_NAMES.has(node.type.typeName.text)
    ) {
      recordOffense(node, 'GCR-cast');
    }
    // Angle-bracket assertion: `<GenerateContentResponse>x`
    if (
      ts.isTypeAssertionExpression(node) &&
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      BANNED_TEST_TYPE_NAMES.has(node.type.typeName.text)
    ) {
      recordOffense(node, 'GCR-cast');
    }
    // Interface / type-alias declarations naming a banned type:
    // `interface LegacyGenerateContentResponse { ... }`
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      BANNED_TEST_TYPE_NAMES.has(node.name.text)
    ) {
      recordOffense(node, 'GCR-identifier');
    }
    // Object-literal candidates envelope: `candidates: [{ content: { parts: ... } }]`
    if (isCandidatesEnvelopeProperty(node)) {
      recordOffense(node, 'candidates-envelope');
    }
    // Standalone role+parts envelope: `{ role: 'user'|'model', parts: [...] }`
    if (ts.isObjectLiteralExpression(node) && isRolePartsEnvelope(node)) {
      recordOffense(node, 'role-parts-envelope');
    }
    // functionCall/functionResponse Part fixtures
    if (ts.isObjectLiteralExpression(node)) {
      const partKind = functionPartKind(node);
      if (partKind !== null) {
        recordOffense(node, partKind);
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return offenses;
}

/**
 * Walk upward from a node to find the enclosing named function/variable.
 * Returns the function name, or null if not inside a named scope.
 */
function enclosingFunctionName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current) && current.name !== undefined) {
      return current.name.text;
    }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (ts.isFunctionExpression(current) && current.name !== undefined) {
      return current.name.text;
    }
    if (
      ts.isArrowFunction(current) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }
    current = current.parent;
  }
  return null;
}

/**
 * Collect ALL enclosing test-block labels (it/describe/test) for a node,
 * from innermost to outermost. Used for allow-list matching where any
 * enclosing block label can grant exemption.
 */
function allEnclosingTestBlockLabels(node: ts.Node): readonly string[] {
  const labels: string[] = [];
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isTestBlockCall(current)) {
      const firstArg = (current as ts.CallExpression).arguments[0];
      if (firstArg !== undefined && ts.isStringLiteral(firstArg)) {
        labels.push(firstArg.text);
      }
    }
    current = current.parent;
  }
  return labels;
}

/**
 * Whether a node is inside a hook-wire context — i.e., under the public
 * hook `hookSpecificOutput.llm_response` wire shape, within a function
 * whose name characterizes the hook-wire adapter boundary, assigned to a
 * variable typed as a hook-wire response type, or inside a describe/it
 * block whose name characterizes the hook-wire adapter.
 *
 * This is used by the allow-list `hook-wire` context pattern to exempt
 * only structural fixtures that construct/characterize the hook JSON wire,
 * while unrelated candidate fixtures in the same file still fail.
 */
function isInHookWireContext(node: ts.Node): boolean {
  // Check if the enclosing scope name characterizes the hook-wire adapter
  const fnName = enclosingFunctionName(node);
  if (fnName !== null && isHookWireFunctionName(fnName)) {
    return true;
  }
  // Check if the node is inside a hookSpecificOutput.llm_response property chain
  if (isInHookSpecificOutputLlmResponse(node)) {
    return true;
  }
  // Check if the candidates envelope is assigned to a variable typed as a
  // hook-wire response type (e.g. HookGenerateContentResponse)
  if (isAssignedToHookWireType(node)) {
    return true;
  }
  // Check if inside a describe/it block whose name characterizes the
  // hook-wire adapter (e.g. describe('afterModelModifiedToChunk ...'))
  return isInHookWireDescribeBlock(node);
}

/** Whether a function name characterizes the hook-wire adapter boundary. */
function isHookWireFunctionName(fnName: string): boolean {
  const lower = fnName.toLowerCase();
  if (lower.includes('hookwire') || lower.includes('hookwireadapter')) {
    return true;
  }
  if (lower.includes('hook') && hasHookWireSuffix(lower)) {
    return true;
  }
  // Named hook-wire mapping functions (from production allow-list)
  const HOOK_WIRE_FN_NAMES: ReadonlySet<string> = new Set([
    'afterModelModifiedToChunk',
    'afterModelModifiedToModelOutput',
    'beforeModelBlockingToModelOutput',
    'afterModelBlockingToModelOutput',
    'extractBlocksFromHookResponse',
    'usageFromHookResponse',
  ]);
  return HOOK_WIRE_FN_NAMES.has(fnName);
}

/** Whether a lowercased name contains 'adapter' or 'wire' (hook-wire suffix). */
function hasHookWireSuffix(lower: string): boolean {
  return lower.includes('adapter') || lower.includes('wire');
}

/** Hook-wire type name patterns. A variable typed with one of these is
 *  carrying the hook JSON-wire response contract. */
const HOOK_WIRE_TYPE_PATTERNS: readonly string[] = [
  'HookGenerateContentResponse',
  'HookResponse',
  'AfterModelHookOutput',
  'BeforeModelHookOutput',
];

/** Whether the candidates envelope node is assigned to a variable whose
 *  type annotation names a hook-wire response type. */
function isAssignedToHookWireType(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    const typeNode = getVarOrAsType(current);
    if (typeNode !== null) {
      const typeName = typeAnnotationText(typeNode);
      if (
        typeName !== null &&
        HOOK_WIRE_TYPE_PATTERNS.some((p) => typeName.includes(p))
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/** Extract the type annotation from a variable declaration or as-expression. */
function getVarOrAsType(node: ts.Node): ts.TypeNode | null {
  if (ts.isVariableDeclaration(node) && node.type !== undefined) {
    return node.type;
  }
  if (ts.isAsExpression(node) && node.type !== undefined) {
    return node.type;
  }
  return null;
}

/** Extract the text of a type annotation node for hook-wire matching. */
function typeAnnotationText(typeNode: ts.TypeNode): string | null {
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    return typeNode.typeName.text;
  }
  // `as unknown as ReturnType<AfterModelHookOutput['getModifiedResponse']>`
  if (ts.isTypeReferenceNode(typeNode)) {
    return typeNode.getText();
  }
  return typeNode.getText();
}

/** Whether the node is inside a describe/it call whose string argument
 *  characterizes the hook-wire adapter (e.g. contains a hook-wire
 *  function name or 'hook' + 'wire'/'adapter'/'response'). */
function isInHookWireDescribeBlock(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (isTestBlockCall(current) && hasHookWireLabel(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

/** Whether a call expression is a describe/it/test call. */
function isTestBlockCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
    return false;
  }
  const name = node.expression.text;
  return name === 'describe' || name === 'it' || name === 'test';
}

/** Whether a describe/it/test call's string label characterizes the
 *  hook-wire adapter boundary. */
function hasHookWireLabel(callNode: ts.CallExpression): boolean {
  const firstArg = callNode.arguments[0];
  if (firstArg === undefined || !ts.isStringLiteral(firstArg)) {
    return false;
  }
  const label = firstArg.text.toLowerCase();
  const HOOK_WIRE_LABELS: readonly string[] = [
    'aftermodelmodifiedtochunk',
    'aftermodelmodifiedtomodeloutput',
    'beforemodelblockingtomodeloutput',
    'aftermodelblockingtomodeloutput',
    'extractblocksfromhookresponse',
    'hookwireadapter',
    'hook',
  ];
  return HOOK_WIRE_LABELS.some((name) => label.includes(name));
}

/**
 * Whether a node is inside (or part of) a `hookSpecificOutput.llm_response`
 * or `hookSpecificOutput: { llm_response: ... }` property chain. This is
 * the public hook JSON-wire boundary.
 */
function isInHookSpecificOutputLlmResponse(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      ts.isPropertyAssignment(current) &&
      ts.isIdentifier(current.name) &&
      (current.name.text === 'llm_response' ||
        current.name.text === 'hookSpecificOutput')
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// ─── Converter boundary detection ─────────────────────────────────────────

/**
 * Named boundary converter functions that explicitly accept Google-shaped
 * wire data (Part/Content/candidates/functionCall/functionResponse) as input
 * and convert it to neutral IContent/ContentBlock. Google-shaped fixtures
 * passed directly as arguments to these functions (or assigned to variables
 * consumed by them in the same test scope) are legitimate boundary
 * characterization, not agents-internal model plumbing.
 */
const BOUNDARY_CONVERTER_NAMES: ReadonlySet<string> = new Set([
  // ContentConverters legacy compat boundary
  'toIContent',
  'toGeminiContents',
  // System instruction wire boundary
  'extractSystemInstructionText',
  // Tool scheduler result conversion boundary
  'convertToFunctionResponse',
  // MessageConverter boundaries (accept legacy Part shapes as AgentMessageInput)
  'normalizeToolInteractionInput',
  'createUserContentWithFunctionResponseFix',
  'convertMixedPartsToIContent',
  // Lossless legacy input converter boundary
  'iContentFromLegacyInput',
]);

/**
 * Whether the offense node is passed as an argument to a named boundary
 * converter function, is inside a call expression to one (nested fixture
 * construction), or is assigned to a variable that is later passed to a
 * boundary converter in the same block scope.
 */
function isInConverterBoundary(node: ts.Node): boolean {
  // Direct: the offense is inside a call expression to a converter
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      BOUNDARY_CONVERTER_NAMES.has(current.expression.text)
    ) {
      return true;
    }
    // Property-access form: ContentConverters.toIContent(...)
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      BOUNDARY_CONVERTER_NAMES.has(current.expression.name.text)
    ) {
      return true;
    }
    current = current.parent;
  }

  // Indirect: the offense is inside a variable declaration whose name is
  // later passed to a boundary converter in the same block scope.
  // Pattern: `const content = { role, parts: [...] }; fn(content);`
  const varDecl = findEnclosingVariableDeclaration(node);
  if (varDecl !== null && ts.isIdentifier(varDecl.name)) {
    const varName = varDecl.name.text;
    const block = findEnclosingBlock(varDecl);
    if (block !== null && isVariablePassedToConverter(block, varName)) {
      return true;
    }
  }

  return false;
}

/** Find the VariableDeclaration enclosing the given node, if any. */
function findEnclosingVariableDeclaration(
  node: ts.Node,
): ts.VariableDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current)) {
      return current;
    }
    // Stop at block boundaries — don't cross into sibling scopes
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      break;
    }
    current = current.parent;
  }
  return null;
}

/** Find the enclosing block (or source file) that contains the given node. */
function findEnclosingBlock(node: ts.Node): ts.Block | ts.SourceFile | null {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isBlock(current) || ts.isSourceFile(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** Whether a variable named `varName` is passed as an argument to a
 *  boundary converter call anywhere inside the given block. Handles
 *  `fn(varName)`, `fn(varName as Type)`, and `fn(varName as unknown as Type)`. */
function isVariablePassedToConverter(
  block: ts.Block | ts.SourceFile,
  varName: string,
): boolean {
  let found = false;
  function visit(node: ts.Node): void {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      isConverterCallExpression(node) &&
      node.arguments.some((arg) => argumentReferencesVariable(arg, varName))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(block, visit);
  return found;
}

/** Whether a call argument references the variable named `varName`,
 *  handling bare identifiers and as-expressions wrapping them. */
function argumentReferencesVariable(
  arg: ts.Expression,
  varName: string,
): boolean {
  if (ts.isIdentifier(arg) && arg.text === varName) return true;
  // Handle `varName as Type` and `varName as unknown as Type`
  if (ts.isAsExpression(arg)) {
    return argumentReferencesVariable(arg.expression, varName);
  }
  // Handle type assertion `<Type>varName`
  if (ts.isTypeAssertionExpression(arg)) {
    return argumentReferencesVariable(arg.expression, varName);
  }
  return false;
}

/** Whether a call expression calls a boundary converter function. */
function isConverterCallExpression(node: ts.CallExpression): boolean {
  if (
    ts.isIdentifier(node.expression) &&
    BOUNDARY_CONVERTER_NAMES.has(node.expression.text)
  ) {
    return true;
  }
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    BOUNDARY_CONVERTER_NAMES.has(node.expression.name.text)
  );
}

/**
 * Whether the node is inside a scope (describe/it/function) whose name or
 * enclosing type annotation references a Legacy/Mock Part/Content type.
 */
function isInLegacyCompatScope(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    // Check variable declarations typed as LegacyContent/LegacyPart/MockPart
    if (ts.isVariableDeclaration(current) && current.type !== undefined) {
      const typeName = typeAnnotationText(current.type);
      if (
        typeName !== null &&
        (typeName.includes('Legacy') || typeName.includes('MockPart'))
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

// ─── Legacy rejection test detection — REMOVED ─────────────────────────────
//
// Test-label keyword auto-exemption has been REMOVED per review finding #4.
// Only structural provenance (converter boundary, legacy compat type
// declarations) and central allow-list entries grant exemptions. Genuine
// legacy rejection tests must be context-allowed via the central allow-list
// with exact file + context pattern entries.

/** Whether a node is a `candidates: [{ content: { parts? } }]` property
 *  assignment forming a Gemini envelope fixture. */
function isCandidatesEnvelopeProperty(node: ts.Node): boolean {
  if (!ts.isPropertyAssignment(node)) return false;
  const name = propertyNameText(node.name);
  if (name !== 'candidates') return false;
  if (!ts.isArrayLiteralExpression(node.initializer)) return false;
  if (node.initializer.elements.length === 0) return false;
  const first = node.initializer.elements[0];
  if (!ts.isObjectLiteralExpression(first)) return false;
  return first.properties.some(
    (p) => ts.isPropertyAssignment(p) && propertyNameText(p.name) === 'content',
  );
}

function propertyNameText(name: ts.Node): string | null {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) {
    const expr = name.expression;
    if (ts.isStringLiteral(expr)) return expr.text;
    // Const identifier: resolve the const to its literal string value.
    if (ts.isIdentifier(expr)) {
      const resolved = resolveConstString(expr);
      if (resolved !== null) return resolved;
    }
  }
  return null;
}

/** Resolve a const identifier reference to its string-literal value by
 *  walking the AST scope. Handles `const k = 'candidates'; [k]`. */
function resolveConstString(node: ts.Identifier): string | null {
  let scope: ts.Node | undefined = node.parent;
  while (scope !== undefined) {
    const result = findConstStringInScope(scope, node.text, node);
    if (result !== null) return result;
    scope = scope.parent;
  }
  return null;
}

/** Search a scope subtree for a const declaration with a string-literal
 *  initializer matching `name`, appearing BEFORE `fromNode`. */
function findConstStringInScope(
  node: ts.Node,
  name: string,
  fromNode: ts.Node,
): string | null {
  if (ts.isVariableStatement(node)) {
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== name) {
        continue;
      }
      const initializer = decl.initializer;
      if (
        initializer !== undefined &&
        ts.isStringLiteral(initializer) &&
        initializer.getStart() < fromNode.getStart()
      ) {
        return initializer.text;
      }
    }
  }
  for (const child of node.getChildren()) {
    const result = findConstStringInScope(child, name, fromNode);
    if (result !== null) return result;
  }
  return null;
}

/**
 * Returns the name of an object-literal property (assignment or shorthand),
 * or null for spread/other property kinds. Avoids nested ternary complexity.
 */
function objectPropertyName(prop: ts.ObjectLiteralElementLike): string | null {
  if (ts.isPropertyAssignment(prop)) return propertyNameText(prop.name);
  if (ts.isShorthandPropertyAssignment(prop)) return prop.name.text;
  return null;
}

/**
 * Whether an object literal is a standalone Google `{ role, parts }`
 * Content envelope (not wrapped inside a candidates array).
 * Supports both identifier and string-literal property keys.
 * A spread assignment does NOT automatically set the flags — the object
 * must carry at least one of the keys explicitly (role or parts) for the
 * other to be inferred from a spread, avoiding false positives on
 * unrelated objects that merely happen to contain a spread.
 */
function isRolePartsEnvelope(node: ts.ObjectLiteralExpression): boolean {
  let hasRole = false;
  let hasParts = false;
  let hasSpread = false;
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      hasSpread = true;
      continue;
    }
    const name = objectPropertyName(prop);
    if (name === 'role') hasRole = true;
    if (name === 'parts') hasParts = true;
  }
  // Only flag when BOTH keys are present explicitly, OR at least one key
  // is present alongside a spread (the spread could supply the other).
  if (hasRole && hasParts) return true;
  if (hasSpread && (hasRole || hasParts)) return true;
  return false;
}

/**
 * Whether an object literal is a Google Part-shaped functionCall or
 * functionResponse fixture. Returns the offense kind, or null when the
 * object does not carry either key.
 * A spread assignment alone is NOT enough — the object must carry the
 * functionCall or functionResponse key explicitly (or via shorthand),
 * avoiding false positives on unrelated objects that happen to spread.
 */
function functionPartKind(
  node: ts.ObjectLiteralExpression,
): StructuralOffense['kind'] | null {
  let hasFunctionCall = false;
  let hasFunctionResponse = false;
  for (const prop of node.properties) {
    if (ts.isSpreadAssignment(prop)) {
      continue;
    }
    const name = objectPropertyName(prop);
    if (name === 'functionCall') hasFunctionCall = true;
    if (name === 'functionResponse') hasFunctionResponse = true;
  }
  if (hasFunctionCall) return 'function-call-part';
  if (hasFunctionResponse) return 'function-response-part';
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const files = findTestFiles(AGENTS_SRC);
  const allowlist = parseTestAllowlist(ALLOWLIST_PATH);

  const importOffenders = findGenaiOffenders(files, ROOT);
  if (importOffenders.length > 0) {
    console.error(
      `FAIL: agents test files still import @google/genai (${importOffenders.length}):`,
    );
    for (const f of importOffenders) {
      console.error(`  ${f}`);
    }
    console.error(
      '\nAll agents test files must use LOCAL structural fixtures (zero @google/genai import).',
    );
    process.exit(1);
  }

  const structuralOffenses = findStructuralOffenders(files, ROOT, allowlist);
  if (structuralOffenses.length > 0) {
    console.error(
      `FAIL: agents test files have banned Google-shaped fixtures (${structuralOffenses.length}):`,
    );
    for (const o of structuralOffenses) {
      console.error(`  ${o.file}:${o.line}:${o.kind}  ${o.snippet}`);
    }
    console.error(
      '\nAgents tests must use neutral ModelStreamChunk/IContent fixtures.',
    );
    console.error(
      'See dev-docs/agents-neutral-gate-allowlist.md for characterization allow-list.',
    );
    process.exit(1);
  }

  console.log(
    `OK: zero @google/genai imports and zero Google-shaped fixtures in ${files.length} agents test files`,
  );
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

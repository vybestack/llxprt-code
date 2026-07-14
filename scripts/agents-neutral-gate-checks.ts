/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Detection checks (a)-(h) and hit collection for the agents-neutral-gate
 * (PLAN-20260707-AGENTNEUTRAL.P31).
 *
 * Each check function walks a TypeScript source file and returns the raw
 * (pre-allow-list) hits it found.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */

import ts from 'typescript';

import {
  type Hit,
  type CheckSubkind,
  BANNED_MODULE_PATTERNS,
  BANNED_SYMBOLS,
  CONTRACT_PREFIX_TYPES,
  GOOGLE_ENUM_NAMES,
  GOOGLE_TYPE_VALUES,
  ROUNDTRIP_SYMBOLS,
  GEMINI_CONTENT_BARREL_TYPES,
  GEMINI_USAGE_KEYS,
  DOMAIN_CANDIDATE_SUFFIXES,
} from './agents-neutral-gate-config.ts';
import {
  getLine,
  relRepo,
  snippetOf,
  parseFile,
  collectImportDecls,
  collectImportedNames,
  calleeName,
  enclosingFunctionName,
} from './agents-neutral-gate-ast.ts';
import {
  propKeyName,
  propertyNameText,
  findRolePartsEnvelope,
  isCandidatesContentAssignment,
  hasGoogleShapedProvenance,
  resolveVarInitializerFromNode,
  typeHasCandidatesMember,
  callHasCandidatesReturnType,
  identifierHasCandidatesProvenance,
} from './agents-neutral-gate-provenance.ts';

// ─── Cheap #2424 vector checks (checkA/B/C/E — REAL fail-mode) ──────────────

/** checkA_rawGenaiImports: flag ALL @google/genai import vectors.
 *
 *  Detects: static import, re-export (export ... from), dynamic import(),
 *  and require() of @google/genai AND its subpaths (@google/genai/*).
 *  Finding #3: the original only detected static `import ... from`, missing
 *  re-exports, dynamic imports, and CJS require — three #2424 re-introduction
 *  vectors. Finding #3 (latest): also reject subpath imports
 *  (import ... from '@google/genai/client') which bypass the bare-module check.
 *
 *  Comments and string literals are naturally ignored because TypeScript
 *  strips them from the AST (no false positives on `// import from
 *  '@google/genai'` or `const s = '@google/genai'`).
 */
export function checkA_rawGenaiImports(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  const seen = new Set<number>();

  /** Whether a module specifier string is @google/genai or a subpath. */
  function isGenaiModule(spec: string): boolean {
    return spec === '@google/genai' || spec.startsWith('@google/genai/');
  }

  function hitAt(node: ts.Node, reason: string): void {
    const pos = node.getStart();
    if (seen.has(pos)) return;
    seen.add(pos);
    hits.push({
      file: rel,
      line: getLine(sf, pos),
      subkind: 'A-raw-genai-import',
      contextSnippet: snippetOf(sf, node),
      reason,
    });
  }
  function visit(node: ts.Node): void {
    // Static import: `import ... from '@google/genai'` or subpath
    if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec) && isGenaiModule(spec.text)) {
        hitAt(node, 'raw import from @google/genai (#2424 vector)');
      }
    }
    // Re-export: `export ... from '@google/genai'` or subpath
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      const spec = node.moduleSpecifier;
      if (ts.isStringLiteral(spec) && isGenaiModule(spec.text)) {
        hitAt(node, 're-export from @google/genai (#2424 vector)');
      }
    }
    // Dynamic import: `import('@google/genai')` or subpath
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) && isGenaiModule(arg.text)) {
        hitAt(node, 'dynamic import() of @google/genai (#2424 vector)');
      }
    }
    // CJS require: `require('@google/genai')` or subpath
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isStringLiteral(arg) && isGenaiModule(arg.text)) {
        hitAt(node, 'require() of @google/genai (#2424 vector)');
      }
    }
    // ImportTypeNode: `import('@google/genai').Content` or subpath
    // — a type-level dynamic import that bypasses the static-import check.
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      isGenaiModule(node.argument.literal.text)
    ) {
      hitAt(node, 'import() type reference to @google/genai (#2424 vector)');
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

// ─── Shared banned-import scanner ───────────────────────────────────────────

function isBannedModule(specifier: string): boolean {
  return BANNED_MODULE_PATTERNS.some((p) => specifier.includes(p));
}

/** Shared import scanner for checkB/checkC: walks banned-module imports and
 *  applies a predicate to each imported name. */
function scanBannedImports(
  sf: ts.SourceFile,
  filePath: string,
  subkind: CheckSubkind,
  predicate: (name: string, specifier: string) => string | null,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  for (const decl of collectImportDecls(sf)) {
    const specNode = decl.moduleSpecifier;
    if (!ts.isStringLiteral(specNode) || !isBannedModule(specNode.text))
      continue;
    for (const name of collectImportedNames(decl)) {
      const reason = predicate(name, specNode.text);
      if (reason !== null) {
        hits.push({
          file: rel,
          line: getLine(sf, decl.getStart()),
          subkind,
          contextSnippet: snippetOf(sf, decl),
          reason,
        });
      }
    }
  }
  return hits;
}

/** Predicate for checkB: banned symbol from banned module. */
function isBannedSymbolPred(name: string, specifier: string): string | null {
  if (!BANNED_SYMBOLS.has(name)) return null;
  return `banned symbol '${name}' from banned module '${specifier}'`;
}

/** checkB_bannedSymbols: flag banned Google symbols ONLY from banned modules
 *  (provenance, NOT bare name — Major 4). */
export function checkB_bannedSymbols(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  return scanBannedImports(sf, filePath, 'B-banned-symbol', isBannedSymbolPred);
}

// ─── checkB2 — imports aliased TO banned legacy names (Finding #3) ──────────

/**
 * checkB2_bannedAliasTargets: flag import specifiers where the LOCAL name
 * (the alias target) is a banned Google symbol — regardless of which module
 * the import comes from. This detects the source-swap bypass:
 *   `import { someNeutralName as GenerateContentResponse } from 'anywhere'`
 *
 * Only flags when `propertyName` exists (a rename) AND the local name
 * (`name.text`) is banned. Does NOT flag the original name-only form
 * (that is checkB's provenance-scoped job).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */
export function checkB2_bannedAliasTargets(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    // Import specifiers: `import { neutral as GenerateContentResponse }`
    if (
      ts.isImportSpecifier(node) &&
      node.propertyName !== undefined &&
      BANNED_SYMBOLS.has(node.name.text)
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'B2-banned-alias-target',
        contextSnippet: snippetOf(sf, node),
        reason: `import aliased TO banned legacy name '${node.name.text}' (source-swap guard)`,
      });
    }
    // Export specifiers: `export { neutral as GenerateContentResponse }`
    // (re-export aliased TO a banned name — same source-swap bypass).
    if (
      ts.isExportSpecifier(node) &&
      node.propertyName !== undefined &&
      BANNED_SYMBOLS.has(node.name.text)
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'B2-banned-alias-target',
        contextSnippet: snippetOf(sf, node),
        reason: `export aliased TO banned legacy name '${node.name.text}' (source-swap guard)`,
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

// ─── checkB3 — local declarations using banned legacy response names ────────

/**
 * Names of banned response/payload types that should not appear as local
 * declarations (class/interface/type/function/const). Covers the
 * response-envelope names (GenerateContentResponse*, Candidate,
 * PartListUnion, PartUnion) plus all Contract* payload aliases. Generic
 * domain names (Type, Tool, Schema, Content, FunctionCall,
 * FunctionDeclaration, Part) are excluded — their import from banned
 * modules is already caught by checkB/checkC, and they have legitimate
 * neutral re-declarations.
 */
const BANNED_RESPONSE_DECLARATION_NAMES: ReadonlySet<string> = new Set([
  'GenerateContentResponse',
  'GenerateContentResponseUsageMetadata',
  'Candidate',
  'PartListUnion',
  'PartUnion',
  'GenerateContentConfig',
  'SendMessageParameters',
  'GoogleGenAI',
  'createUserContent',
  ...CONTRACT_PREFIX_TYPES,
]);

/**
 * checkB3_bannedLocalDeclarations: flag local declarations (class, interface,
 * type alias, function, const/let/var) whose name is a banned legacy response
 * name. This detects local re-declarations that shadow the banned Google
 * types regardless of source.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */
export function checkB3_bannedLocalDeclarations(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  function checkDecl(
    name: string | undefined,
    node: ts.Node,
    kindLabel: string,
  ): void {
    if (name !== undefined && BANNED_RESPONSE_DECLARATION_NAMES.has(name)) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'B3-banned-local-decl',
        contextSnippet: snippetOf(sf, node),
        reason: `local ${kindLabel} uses banned legacy response name '${name}'`,
      });
    }
  }
  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node))
      checkDecl(node.name?.text, node, 'class declaration');
    if (ts.isInterfaceDeclaration(node))
      checkDecl(node.name.text, node, 'interface declaration');
    if (ts.isTypeAliasDeclaration(node))
      checkDecl(node.name.text, node, 'type alias');
    if (ts.isFunctionDeclaration(node))
      checkDecl(node.name?.text, node, 'function declaration');
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
      checkDecl(node.name.text, node, 'variable declaration');
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

/** Predicate for checkC: Contract* alias from banned module. */
function isContractAliasPred(name: string, specifier: string): string | null {
  if (!CONTRACT_PREFIX_TYPES.includes(name)) return null;
  return `Contract* alias '${name}' from '${specifier}'`;
}

/** checkC_contractAliases: flag Contract* payload aliases (#2424 vector). */
export function checkC_contractAliases(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  return scanBannedImports(
    sf,
    filePath,
    'C-contract-alias',
    isContractAliasPred,
  );
}

// ─── checkE — enum re-declarations (value-aware) ────────────────────────────

/**
 * Collect all string-literal values from an enum declaration's members.
 * Handles both `Member = 'VALUE'` and `Member = "VALUE"` forms.
 */
function collectEnumMemberValues(node: ts.EnumDeclaration): string[] {
  const values: string[] = [];
  for (const member of node.members) {
    if (
      member.initializer !== undefined &&
      ts.isStringLiteral(member.initializer)
    ) {
      values.push(member.initializer.text);
    }
  }
  return values;
}

/**
 * Collect all string-literal values from a variable declaration's initializer.
 * Handles object literals (with or without `as const`): `{ KEY: 'VALUE' }`.
 */
function collectVarInitializerStringValues(
  decl: ts.VariableDeclaration,
): string[] {
  const values: string[] = [];
  if (decl.initializer === undefined) return values;
  // Unwrap `as const` / type assertions to get the underlying object literal.
  let init: ts.Expression = decl.initializer;
  while (ts.isAssertionExpression(init) || ts.isAsExpression(init)) {
    init = init.expression;
  }
  if (ts.isObjectLiteralExpression(init)) {
    for (const prop of init.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isStringLiteral(prop.initializer)
      ) {
        values.push(prop.initializer.text);
      }
    }
  } else if (ts.isStringLiteral(init)) {
    values.push(init.text);
  }
  return values;
}

/** Whether an enum declaration carries any Google uppercase Type value. */
function enumDeclHasGoogleTypeValue(node: ts.EnumDeclaration): boolean {
  return collectEnumMemberValues(node).some((v) => GOOGLE_TYPE_VALUES.has(v));
}

/** Whether a variable declaration carries any Google uppercase Type value. */
function varDeclHasGoogleTypeValue(decl: ts.VariableDeclaration): boolean {
  return collectVarInitializerStringValues(decl).some((v) =>
    GOOGLE_TYPE_VALUES.has(v),
  );
}

/** checkE_enumRedeclarations: flag local enum/const FinishReason/Type.
 *
 *  For `Type` specifically, detection is VALUE-AWARE: a local `Type` const
 *  or enum is flagged ONLY when it carries at least one Google uppercase
 *  string value (STRING, OBJECT, ARRAY, NUMBER, BOOLEAN, INTEGER). This
 *  avoids false positives on neutral lowercase `Type` aliases/objects
 *  (e.g. `const Type = { string: 'string', object: 'object' }`).
 *
 *  @plan:PLAN-20260707-AGENTNEUTRAL.P31
 *  @requirement:REQ-012.1
 */
export function checkE_enumRedeclarations(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    if (ts.isEnumDeclaration(node) && GOOGLE_ENUM_NAMES.has(node.name.text)) {
      // Type enum is value-aware; FinishReason is always flagged.
      if (node.name.text === 'Type' && !enumDeclHasGoogleTypeValue(node)) {
        return;
      }
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'E-enum-redeclaration',
        contextSnippet: snippetOf(sf, node),
        reason: `local enum '${node.name.text}' re-declares a Google enum`,
      });
    }
    if (ts.isVariableStatement(node)) {
      const isConst = (node.modifiers ?? []).some(
        (m) => m.kind === ts.SyntaxKind.ConstKeyword,
      );
      const declHits: Hit[] = node.declarationList.declarations
        .filter(
          (decl): decl is ts.VariableDeclaration & { name: ts.Identifier } =>
            ts.isIdentifier(decl.name) && GOOGLE_ENUM_NAMES.has(decl.name.text),
        )
        .filter(
          (decl) =>
            !(decl.name.text === 'Type' && !varDeclHasGoogleTypeValue(decl)),
        )
        .map<Hit>((decl) => ({
          file: rel,
          line: getLine(sf, node.getStart()),
          subkind: 'E-enum-redeclaration',
          contextSnippet: snippetOf(sf, node),
          reason: `local ${isConst ? 'const' : 'variable'} '${decl.name.text}' shadows a Google enum`,
        }));
      hits.push(...declHits);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

// ─── checkF structural matchers (F1/F3/F5 — count mode) ────────────────────

function isDomainCandidateType(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/[,;)]$/, '')
    .trim();
  return DOMAIN_CANDIDATE_SUFFIXES.some((suffix) =>
    normalized.endsWith(suffix),
  );
}

/** F1: `candidates: [{ content: { role?, parts? } }]` — structural Gemini envelope.
 *
 *  Finding #2 enhancements:
 *  - Supports identifier AND string-literal property keys.
 *  - Inspects ALL candidate elements (not just the first).
 *  - Requires content to be an object literal with `role` or `parts`
 *    (avoids false positives on neutral {candidates:[{content:'plain'}]}). */
function checkF1_candidatesContent(sf: ts.SourceFile, rel: string): Hit[] {
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    if (isCandidatesContentAssignment(node)) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'F1-candidates-content',
        contextSnippet: snippetOf(sf, node),
        reason: 'structural {candidates:[{content:{role?,parts?}}]} envelope',
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return filterDomainCandidates(sf, hits);
}

/**
 * F3: `{ role: 'user'|'model', parts: ... }` — structural Gemini envelope.
 *
 * Finding #2: supports identifier AND string-literal property keys.
 */
function checkF3_roleParts(sf: ts.SourceFile, rel: string): Hit[] {
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    if (ts.isObjectLiteralExpression(node)) {
      const roleNode = findRolePartsEnvelope(sf, node.properties);
      if (roleNode !== null) {
        hits.push({
          file: rel,
          line: getLine(sf, roleNode.getStart()),
          subkind: 'F3-role-parts',
          contextSnippet: snippetOf(sf, node),
          reason: "structural {role:'user'|'model', parts} envelope",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

/**
 * F5: spread + parts mutation, AND direct `.parts` property/element reads.
 *
 * Finding #2 enhancements:
 * - Supports string-literal keys in spread checks.
 * - Detects direct `.parts` property reads (`message.parts`) and
 *   bracket/element-access reads (`content['parts']`).
 *
 * Finding #5 enhancements:
 * - Constrains `.parts` reads/mutations to bases with Google-shaped
 *   provenance (Content role/parts object literal or candidates envelope).
 *   Unrelated domain objects like `const domain = { parts: ['wheel'] }`
 *   do NOT have Gemini Content provenance and are spared.
 *   Access inside type declarations (PropertySignature) is excluded.
 */
function checkF5_partsAccess(sf: ts.SourceFile, rel: string): Hit[] {
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    // Spread assignment with sibling `parts` property (string-literal support)
    if (
      ts.isSpreadAssignment(node) &&
      ts.isObjectLiteralExpression(node.parent) &&
      node.parent.properties.some((p) => propKeyName(p) === 'parts')
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'F5-parts-access',
        contextSnippet: snippetOf(sf, node),
        reason: 'spread assignment with sibling parts property',
      });
    }
    // Direct `.parts` property read: `message.parts`
    // Constrained to bases with Google-shaped provenance (Finding #5):
    // only flag when the base resolves to a Content/candidates envelope
    // value or a parameter typed with a `parts` member, avoiding false
    // positives on unrelated domain objects like
    // `const domain = { parts: ['wheel'] }; domain.parts.length`.
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'parts' &&
      hasGoogleShapedProvenance(sf, node.expression)
    ) {
      const fn = enclosingFunctionName(node) ?? '';
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'F5-parts-access',
        contextSnippet: `${fn} ${snippetOf(sf, node)}`,
        reason: 'direct .parts property access on Google-shaped value',
      });
    }
    // Bracket/element access: `content['parts']`
    // The literal string 'parts' is an explicit named key — this form is
    // always flagged because bracket access with a literal property name
    // is a structural access pattern, not a dynamic record lookup.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === 'parts'
    ) {
      const fn = enclosingFunctionName(node) ?? '';
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'F5-parts-access',
        contextSnippet: `${fn} ${snippetOf(sf, node)}`,
        reason: "bracket/element access ['parts']",
      });
    }
    // Const-computed key access: `const key = 'parts'; wire[key]`
    // where the base has Google-shaped provenance. Resolves the const
    // identifier to its string-literal initializer and checks provenance
    // on the base expression — same constraint as direct .parts reads.
    // Safe neutral computed keys (e.g. `const k = 'candidates'; obj[k]`
    // on a neutral object) stay pass because hasGoogleShapedProvenance
    // returns false for non-Google-shaped bases.
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.argumentExpression)
    ) {
      const resolved = resolveVarInitializerFromNode(
        sf,
        node.argumentExpression,
      );
      if (
        resolved !== null &&
        ts.isStringLiteral(resolved) &&
        resolved.text === 'parts' &&
        hasGoogleShapedProvenance(sf, node.expression)
      ) {
        const fn = enclosingFunctionName(node) ?? '';
        hits.push({
          file: rel,
          line: getLine(sf, node.getStart()),
          subkind: 'F5-parts-access',
          contextSnippet: `${fn} ${snippetOf(sf, node)}`,
          reason:
            "const-computed bracket access [key] where key='parts' on Google-shaped value",
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return filterDomainCandidates(sf, hits);
}

// ─── EXCLUDE guard ──────────────────────────────────────────────────────────

/** EXCLUDE guard: remove hits on the specific line whose text contains a
 *  domain *Candidate[] type annotation (false-positive guard). Only the
 *  hit's own line is checked to avoid false-negatives from unrelated
 *  Candidate[] references on adjacent lines. */
function filterDomainCandidates(sf: ts.SourceFile, hits: Hit[]): Hit[] {
  const lines = sf.text.split('\n');
  return hits.filter((hit) => {
    const lineText = lines[hit.line - 1] ?? '';
    return !isDomainCandidateType(lineText);
  });
}

/** checkF_structuralEnvelopes (pseudocode lines 26-35): F1/F3/F5/F6/F7 + EXCLUDE. */
export function checkF_structuralEnvelopes(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  return [
    ...checkF1_candidatesContent(sf, rel),
    ...checkF3_roleParts(sf, rel),
    ...checkF5_partsAccess(sf, rel),
    ...checkF6_partsDestructure(sf, rel),
    ...checkF7_candidatesTypedEnvelope(sf, rel),
  ];
}

/**
 * F6: destructured `parts` on response-shaped values.
 *
 * Detects `const { parts } = response` (and `const { parts: p } = response`)
 * where the destructured source identifier has Google-shaped provenance
 * (a Content role/parts object literal or candidates envelope). Constrains
 * to Google-shaped provenance to avoid false positives on neutral domain
 * objects with a `parts` property.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */
function checkF6_partsDestructure(sf: ts.SourceFile, rel: string): Hit[] {
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer)
    ) {
      // Check if any binding element destructures `parts`
      const hasPartsBinding = node.name.elements.some((el) => {
        if (!ts.isBindingElement(el)) return false;
        if (ts.isIdentifier(el.name)) return el.name.text === 'parts';
        return false;
      });
      if (hasPartsBinding && hasGoogleShapedProvenance(sf, node.initializer)) {
        hits.push({
          file: rel,
          line: getLine(sf, node.getStart()),
          subkind: 'F6-parts-destructure',
          contextSnippet: snippetOf(sf, node),
          reason: 'destructured `parts` from response-shaped value',
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

/**
 * F7: candidates-bearing response envelope typed or assigned from a call.
 *
 * Detects variable declarations explicitly typed with a candidates-bearing
 * type annotation (type literal with a `candidates` member), or assigned a
 * candidates-envelope value from a function call. This catches:
 *   `const x: { candidates: unknown[] } = getResponse();`
 *   `const x = getResponse(); x.candidates`
 * even when the initializer is a call expression (not an object literal).
 *
 * Provenance requirement: a bare `.candidates` property access on a call
 * result or call-assigned variable is ONLY flagged when the call or variable
 * has a type annotation bearing a `candidates` member. This avoids false
 * positives on unrelated domain code that happens to use `.candidates`
 * (e.g., `getSearchResults().candidates` from a legitimate search API).
 *
 * Uses the existing F1 detection for inline `{ candidates: [...] }` literals;
 * F7 extends coverage to call-returning values typed with candidates.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 */
function checkF7_candidatesTypedEnvelope(
  sf: ts.SourceFile,
  rel: string,
): Hit[] {
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    // Variable declaration with a type annotation containing `candidates`
    if (
      ts.isVariableDeclaration(node) &&
      node.type !== undefined &&
      typeHasCandidatesMember(node.type)
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'F7-candidates-typed-envelope',
        contextSnippet: snippetOf(sf, node),
        reason: 'variable typed with candidates-bearing response envelope',
      });
    }
    // `.candidates` property access — only when the base has candidates
    // provenance (typed envelope or call-returning envelope). This avoids
    // false positives on any-call `.candidates` access.
    if (isCandidatesAccessWithProvenance(sf, node)) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'F7-candidates-typed-envelope',
        contextSnippet: snippetOf(sf, node),
        reason: '.candidates access on candidates-bearing response envelope',
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

/**
 * Whether `node` is a `.candidates` property access on a value with
 * candidates-bearing provenance (call return type or variable type).
 */
function isCandidatesAccessWithProvenance(
  sf: ts.SourceFile,
  node: ts.Node,
): boolean {
  if (!ts.isPropertyAccessExpression(node)) return false;
  if (!ts.isIdentifier(node.name) || node.name.text !== 'candidates') {
    return false;
  }
  // Direct `.candidates` on a call with candidates return type.
  if (
    ts.isCallExpression(node.expression) &&
    callHasCandidatesReturnType(node.expression)
  ) {
    return true;
  }
  // `.candidates` on a variable with candidates provenance.
  if (
    ts.isIdentifier(node.expression) &&
    identifierHasCandidatesProvenance(sf, node.expression)
  ) {
    return true;
  }
  return false;
}

/** checkG_converterCalls: `toGeminiContent(s)(` call matcher. */
export function checkG_converterCalls(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee === 'toGeminiContent' || callee === 'toGeminiContents') {
        hits.push({
          file: rel,
          line: getLine(sf, node.getStart()),
          subkind: 'G-call-toGeminiContent',
          contextSnippet: snippetOf(sf, node),
          reason: `toGeminiContent(s) converter call (${callee})`,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

// ─── EXPENSIVE checks (full fail-mode — P31) ────────────────────────────────

/**
 * checkD_roundtripSymbols: flag deleted-helper / round-trip conversion
 * symbol identifiers. Detects these as: imported names, type-reference
 * names, call-expression callees, and new-expression callees.
 *
 * Catches re-introduction of the deleted bridge/round-trip paths that
 * would recreate a Google↔neutral conversion loop (#2424 vector).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode line 18
 */
export function checkD_roundtripSymbols(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  const seen = new Set<string>();
  function record(node: ts.Node, name: string): void {
    const key = `${getLine(sf, node.getStart())}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push({
      file: rel,
      line: getLine(sf, node.getStart()),
      subkind: 'D-roundtrip-symbol',
      contextSnippet: snippetOf(sf, node),
      reason: `round-trip conversion symbol '${name}' (deleted-helper guard)`,
    });
  }
  function visit(node: ts.Node): void {
    // Import specifiers: `import { streamChunkWrapper } from '...'`
    if (ts.isImportSpecifier(node) && node.name.text !== 'default') {
      const name = node.propertyName?.text ?? node.name.text;
      if (ROUNDTRIP_SYMBOLS.has(name)) {
        record(node, name);
      }
    }
    // Function declarations: `function streamChunkWrapper() {}` (Finding #3)
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      ROUNDTRIP_SYMBOLS.has(node.name.text)
    ) {
      record(node, node.name.text);
    }
    // Class declarations: `class streamChunkWrapper {}` (Finding #3)
    if (
      ts.isClassDeclaration(node) &&
      node.name !== undefined &&
      ROUNDTRIP_SYMBOLS.has(node.name.text)
    ) {
      record(node, node.name.text);
    }
    // Variable declarations: `const providerStopReason = ...` (Finding #3)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      ROUNDTRIP_SYMBOLS.has(node.name.text)
    ) {
      record(node, node.name.text);
    }
    // Type references: `x: providerStopReason`
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      ROUNDTRIP_SYMBOLS.has(node.typeName.text)
    ) {
      record(node, node.typeName.text);
    }
    // Call expressions: `convertIContentToResponse(...)`
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (ROUNDTRIP_SYMBOLS.has(callee)) {
        record(node, callee);
      }
    }
    // New expressions: `new streamChunkWrapper(...)`
    if (ts.isNewExpression(node)) {
      const callee = calleeName(node.expression);
      if (ROUNDTRIP_SYMBOLS.has(callee)) {
        record(node, callee);
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

/**
 * checkG_barrelImports: flag GeminiContent* barrel type imports from ANY
 * module. These barrel re-exports are the Google payload shape — their
 * import into agents signals a direct structural dependency on the
 * Google wire types.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode line 21
 */
export function checkG_barrelImports(
  sf: ts.SourceFile,
  filePath: string,
): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  for (const decl of collectImportDecls(sf)) {
    const specNode = decl.moduleSpecifier;
    if (!ts.isStringLiteral(specNode)) continue;
    const names = collectImportedNames(decl);
    for (const name of names) {
      if (GEMINI_CONTENT_BARREL_TYPES.has(name)) {
        hits.push({
          file: rel,
          line: getLine(sf, decl.getStart()),
          subkind: 'G-barrel-GeminiContent',
          contextSnippet: snippetOf(sf, decl),
          reason: `GeminiContent* barrel import '${name}' from '${specNode.text}'`,
        });
      }
    }
  }
  return hits;
}

/**
 * checkH_usageKeys: flag Gemini usage-metadata key names used as property
 * identifiers outside boundary modules. The AST-context allow-list
 * subtracts: (a) members of the declared UsageMetadataValue type in
 * event-types.ts/event-schema.ts; (b) nodes inside the
 * usageStatsToPublicUsageMetadata function body in eventAdapter.ts.
 *
 * Detects ALL property-key forms: Identifier names, quoted StringLiteral
 * keys (`{ 'promptTokenCount': 1 }`), and bracket/element access
 * (`usage['promptTokenCount']`) — Finding #2.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P31
 * @requirement:REQ-012.1
 * @pseudocode lines 36-39
 */
export function checkH_usageKeys(sf: ts.SourceFile, filePath: string): Hit[] {
  const rel = relRepo(filePath);
  const hits: Hit[] = [];
  function visit(node: ts.Node): void {
    // Property signatures in type declarations: `promptTokenCount?: number;`
    // or `'promptTokenCount'?: number;` (Finding #2: StringLiteral keys)
    if (ts.isPropertySignature(node) && node.name !== undefined) {
      const name = propertyNameText(node.name);
      if (name !== null && GEMINI_USAGE_KEYS.has(name)) {
        hits.push({
          file: rel,
          line: getLine(sf, node.getStart()),
          subkind: 'H-usage-key',
          contextSnippet: snippetOf(sf, node),
          reason: `Gemini usage key '${name}' in type declaration`,
          inTypeDecl: true,
        });
      }
    }
    // Property assignments in object literals: `promptTokenCount: x`
    // or `'promptTokenCount': x` (Finding #2: StringLiteral keys)
    if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      if (name !== null && GEMINI_USAGE_KEYS.has(name)) {
        hits.push({
          file: rel,
          line: getLine(sf, node.getStart()),
          subkind: 'H-usage-key',
          contextSnippet: snippetOf(sf, node),
          reason: `Gemini usage key '${name}' in object literal`,
          enclosingFn: enclosingFunctionName(node),
          inTypeDecl: false,
        });
      }
    }
    // Property access / optional chaining: `u.promptTokenCount`
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      GEMINI_USAGE_KEYS.has(node.name.text)
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'H-usage-key',
        contextSnippet: snippetOf(sf, node),
        reason: `Gemini usage key '${node.name.text}' property access`,
        enclosingFn: enclosingFunctionName(node),
        inTypeDecl: false,
      });
    }
    // Bracket / element access: `usage['promptTokenCount']`
    // (Finding #2: ElementAccessExpression with StringLiteral argument)
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      GEMINI_USAGE_KEYS.has(node.argumentExpression.text)
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'H-usage-key',
        contextSnippet: snippetOf(sf, node),
        reason: `Gemini usage key '${node.argumentExpression.text}' bracket access`,
        enclosingFn: enclosingFunctionName(node),
        inTypeDecl: false,
      });
    }
    // Shorthand property in object literal: `{ promptTokenCount }`
    if (
      ts.isShorthandPropertyAssignment(node) &&
      GEMINI_USAGE_KEYS.has(node.name.text)
    ) {
      hits.push({
        file: rel,
        line: getLine(sf, node.getStart()),
        subkind: 'H-usage-key',
        contextSnippet: snippetOf(sf, node),
        reason: `Gemini usage key '${node.name.text}' shorthand property`,
        enclosingFn: enclosingFunctionName(node),
        inTypeDecl: false,
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
  return hits;
}

// ─── Hit collection ─────────────────────────────────────────────────────────

/** Collect structural hits (checkD + checkF + checkG-call + checkG-barrel +
 *  checkH) for --count/--by-file/--explain.
 *  @pseudocode lines 40-48 */
export function collectStructuralHits(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const sf = parseFile(file);
    if (sf === null) continue;
    hits.push(...checkD_roundtripSymbols(sf, file));
    hits.push(...checkB2_bannedAliasTargets(sf, file));
    hits.push(...checkB3_bannedLocalDeclarations(sf, file));
    hits.push(...checkF_structuralEnvelopes(sf, file));
    hits.push(...checkG_converterCalls(sf, file));
    hits.push(...checkG_barrelImports(sf, file));
    hits.push(...checkH_usageKeys(sf, file));
  }
  return hits;
}

/** Collect ALL hits (checkA-H) for --enforce-imports fail-mode (full check set).
 *  @pseudocode lines 25a-25h, 10-25 */
export function collectImportHits(files: readonly string[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of files) {
    const sf = parseFile(file);
    if (sf === null) continue;
    hits.push(...checkA_rawGenaiImports(sf, file));
    hits.push(...checkB_bannedSymbols(sf, file));
    hits.push(...checkB2_bannedAliasTargets(sf, file));
    hits.push(...checkB3_bannedLocalDeclarations(sf, file));
    hits.push(...checkC_contractAliases(sf, file));
    hits.push(...checkD_roundtripSymbols(sf, file));
    hits.push(...checkE_enumRedeclarations(sf, file));
    hits.push(...checkF_structuralEnvelopes(sf, file));
    hits.push(...checkG_converterCalls(sf, file));
    hits.push(...checkG_barrelImports(sf, file));
    hits.push(...checkH_usageKeys(sf, file));
  }
  return hits;
}

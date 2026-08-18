/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Static false-green test scanner (issue #3240).
 *
 * Parses test files with the TypeScript compiler API and flags patterns that
 * make a test pass regardless of production correctness ("false greens").
 * Catalog adapted from the falsegreen-js project, test-smell literature, and
 * two repo-specific rules (MOCK_MIRROR, SOURCE_MIRROR) that measured the
 * highest confirmed-real precision in the 2026-08 audit (57.5% for
 * MOCK_MIRROR vs 0-17% for generic heuristics).
 *
 * Intended routine (quarterly, ~seconds):
 *   1. `bun scripts/test-audit/scan.ts [outDir]` from the repo root.
 *   2. Triage MOCK_MIRROR hits only (the one rule with measured precision).
 *   3. Watch trend numbers: MOCK_MIRROR per 1k tests, and HIGH-tier flags
 *      per test by file-origin era (2026-08 baseline: 0.42% current era).
 *
 * Full methodology and audit data: research/useless-test-detection-2026-08.md
 * and research/test-audit-report-2026-08.md.
 *
 * Flags are per-test findings, NOT per-file verdicts: a file can be
 * substantive while containing one thin test. scripts/tests/** YAML-assert
 * contract tests are intentionally flagged SOURCE_MIRROR (annotated).
 */
import ts from 'typescript';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
  type Stats,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export interface Finding {
  file: string;
  line: number;
  test: string;
  flag: string;
  detail: string;
  area: string;
}

export interface ScanStats {
  files: number;
  tests: number;
  asserts: number;
  errors: number;
  errorFiles: string[];
}

export interface ScanResult {
  findings: Finding[];
  stats: ScanStats;
  perFile: Map<string, { tests: number; asserts: number }>;
}

interface ExpectInfo {
  matcher: string;
  isNegated: boolean;
  actualText: string;
  expectedText: string;
  expectedLiteral: string | null;
  node: ts.CallExpression;
  line: number;
}

interface TestRec {
  file: string;
  name: string;
  body: ts.Block | ts.ConciseBody;
  expects: ExpectInfo[];
  mockLits: string[];
  stringAsserts: string[];
}

const WEAK_MATCHERS = new Set([
  'toBeDefined',
  'toBeTruthy',
  'toBeNaN',
  'toExist',
]);
const CALL_MATCHERS = /^toHaveBeenCalled/;
const EQUALITY_MATCHERS =
  /^(toBe|toEqual|toStrictEqual|toMatchObject|toBeCloseTo)$/;
const SNAPSHOT_MATCHERS = new Set([
  'toMatchSnapshot',
  'toMatchInlineSnapshot',
  'toMatchFileSnapshot',
]);
const MOCK_CONFIG = new Set([
  'mockReturnValue',
  'mockReturnValueOnce',
  'mockResolvedValue',
  'mockResolvedValueOnce',
]);

const DEFAULT_ROOTS = ['packages', 'scripts/tests', 'integration-tests'];
const DEFAULT_OUT_DIR = 'tmp/test-audit';

export function collectTestFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e.startsWith('.')) continue;
    const p = join(dir, e);
    let st: Stats | undefined;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) collectTestFiles(p, out);
    else if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(e)) out.push(p);
  }
  return out;
}

function stableLiteral(n: ts.Node | undefined): string | null {
  if (!n) return null;
  if (ts.isStringLiteral(n)) return JSON.stringify(n.text);
  if (ts.isNoSubstitutionTemplateLiteral(n)) return JSON.stringify(n.text);
  if (ts.isNumericLiteral(n)) return n.text;
  if (
    n.kind === ts.SyntaxKind.PrefixUnaryExpression &&
    ts.isNumericLiteral((n as ts.PrefixUnaryExpression).operand)
  ) {
    const unary = n as ts.PrefixUnaryExpression;
    const operand = unary.operand as ts.NumericLiteral;
    return `${unary.operator}${operand.text}`;
  }
  if (n.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (n.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (n.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isObjectLiteralExpression(n)) {
    const parts = n.properties.map((p) => {
      if (ts.isPropertyAssignment(p)) {
        const v = stableLiteral(p.initializer);
        return v === null ? null : `${p.name.getText()}:${v}`;
      }
      if (ts.isShorthandPropertyAssignment(p)) return `${p.name.getText()}:?`;
      return '?';
    });
    // If any child is not a stable literal, reject the whole object.
    if (parts.some((p) => p === null)) return null;
    return `{${parts.sort().join(',')}}`;
  }
  if (ts.isArrayLiteralExpression(n)) {
    const elems = n.elements.map((e) => stableLiteral(e));
    if (elems.some((e) => e === null)) return null;
    return `[${elems.join(',')}]`;
  }
  return null;
}

/**
 * Strip line comments and block comments from source text so that
 * commented-out assertions (e.g., `// expect(x).toBe(true)`) do not
 * satisfy the NO_ASSERT regex fallback.
 */
function stripComments(text: string): string {
  // Remove block comments and line comments while respecting string,
  // template, and regex literals — a naive regex would eat comment-like
  // sequences inside strings or regexes (e.g., URLs, /\/\//).
  let out = '';
  let i = 0;
  let inString: '"' | "'" | '`' | null = null;
  let inRegex = false;
  let inClass = false; // inside regex character class [ ... ]
  while (i < text.length) {
    if (inString) {
      out += text[i];
      if (text[i] === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (text[i] === inString) inString = null;
      i++;
    } else if (inRegex) {
      out += text[i];
      if (text[i] === '\\') {
        out += text[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (text[i] === '[') inClass = true;
      else if (text[i] === ']' && inClass) inClass = false;
      else if (text[i] === '/' && !inClass) inRegex = false;
      i++;
    } else if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      inString = text[i] as '"' | "'" | '`';
      out += text[i];
      i++;
    } else if (text[i] === '/' && text[i + 1] === '/') {
      // Line comment — skip to end of line.
      while (i < text.length && text[i] !== '\n') i++;
    } else if (text[i] === '/' && text[i + 1] === '*') {
      // Block comment — skip to closing */.
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/'))
        i++;
      i += 2;
    } else if (text[i] === '/' && isRegexStart(out)) {
      // Regex literal — copy verbatim until the closing unescaped /.
      inRegex = true;
      out += text[i];
      i++;
    } else {
      out += text[i];
      i++;
    }
  }
  return out;
}

// Determine whether a '/' at the current position starts a regex literal
// (as opposed to a division operator) by examining the last meaningful
// character emitted.  Per JS lexical grammar, '/' is a regex start when
// preceded by an operator, opening bracket, comma, semicolon, or keyword.
function isRegexStart(out: string): boolean {
  let end = out.length;
  while (end > 0 && /\s/.test(out[end - 1])) end--;
  const trimmed = end === 0 ? '' : out.slice(0, end);
  if (trimmed.length === 0) return true; // start of file
  const last = trimmed[trimmed.length - 1];
  return (
    last === '(' ||
    last === ',' ||
    last === '=' ||
    last === ':' ||
    last === '[' ||
    last === '!' ||
    last === '&' ||
    last === '|' ||
    last === '?' ||
    last === '{' ||
    last === ';' ||
    last === '}' ||
    last === '+' ||
    last === '-' ||
    last === '*' ||
    last === '%' ||
    last === '<' ||
    last === '>' ||
    last === '\n'
  );
}

const DESCRIBE_ROOTS = new Set([
  'describe',
  'describe.skip',
  'describe.only',
  'describe.concurrent',
]);
const TEST_ROOTS = new Set([
  'it',
  'test',
  'it.only',
  'it.skip',
  'it.concurrent',
  'test.only',
  'test.skip',
  'test.concurrent',
]);

function areaOf(file: string): string {
  // Normalize to forward slashes for cross-platform consistency.
  const parts = file.replace(/\\/g, '/').split('/');
  const pkgIdx = parts.indexOf('packages');
  if (pkgIdx >= 0 && parts[pkgIdx + 1]) return parts[pkgIdx + 1];
  const scriptsIdx = parts.indexOf('scripts');
  if (scriptsIdx >= 0) return 'scripts';
  const intIdx = parts.indexOf('integration-tests');
  if (intIdx >= 0) return 'integration-tests';
  return 'other';
}

function literalOfText(text: string): string | null {
  const t = text.trim();
  // String literal
  if (/^"[^"]*"$/.test(t)) return t;
  if (/^'[^']*'$/.test(t)) return `"${t.slice(1, -1)}"`;
  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(t)) return t;
  // Boolean/null
  if (t === 'true' || t === 'false' || t === 'null') return t;
  return null;
}

function isPlainActual(text: string): boolean {
  const t = text.trim();
  // A "plain" actual is a simple identifier or member-access chain —
  // not a transformation (call, binary op, template, etc.).
  return /^[a-zA-Z_$][\w$]*(\.[a-zA-Z_$][\w$]*)*$/.test(t);
}

interface CallChain {
  root: string;
  suffixes: string[];
}

/**
 * Unwrap decorator-style call chains: it.skipIf(cond)('name', fn) →
 * { root: 'it', suffixes: ['skipIf'] }. Also handles simple calls:
 * it('name', fn) → { root: 'it', suffixes: [] }.
 */
function unwrapCallChain(node: ts.CallExpression): CallChain | null {
  const walk: string[] = [];
  let current: ts.Expression = node.expression;
  while (true) {
    if (ts.isPropertyAccessExpression(current)) {
      walk.unshift(current.name.text);
      current = current.expression;
    } else if (ts.isCallExpression(current)) {
      // This is a curried call like it.each(rows)('name', fn).
      // The callee of the inner call is the property access.
      const innerCallee = current.expression;
      if (ts.isPropertyAccessExpression(innerCallee)) {
        walk.unshift(innerCallee.name.text);
        current = innerCallee.expression;
        continue;
      }
      return null;
    } else if (ts.isIdentifier(current)) {
      return { root: current.text, suffixes: walk };
    } else {
      return null;
    }
  }
}

/**
 * Match an expect(x).matcher(y) chain and extract ExpectInfo.
 * Returns null if the node is not an expect() call chain.
 */
function matchExpectChain(node: ts.CallExpression): ExpectInfo | null {
  // The node should be the outermost call: expect(x).matcher(y)
  // or expect(x).not.matcher(y) or expect(x).resolves.matcher(y) etc.
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const matcherNode = node.expression;
  const matcher = matcherNode.name.text;

  // Walk backward through modifier property accesses (.not, .rejects,
  // .resolves) to reach the expect(x) call.
  let isNegated = false;
  let current: ts.Expression = matcherNode.expression;

  while (ts.isPropertyAccessExpression(current)) {
    const modifier = current.name.text;
    if (modifier === 'not') {
      isNegated = true;
    } else if (modifier === 'rejects' || modifier === 'resolves') {
      // These are valid modifiers — just continue walking.
    } else {
      // Unknown property access — not an expect chain.
      return null;
    }
    current = current.expression;
  }

  // current should now be the expect(x) call.
  if (!ts.isCallExpression(current)) return null;
  if (
    !ts.isIdentifier(current.expression) ||
    current.expression.text !== 'expect'
  )
    return null;

  const actualNode = current;
  const actualText = actualNode.arguments[0]?.getText() ?? '';
  const expectedNode = node.arguments[0];
  const expectedText = expectedNode?.getText() ?? '';
  const expectedLiteral = expectedNode ? stableLiteral(expectedNode) : null;

  const line =
    node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line +
    1;

  return {
    matcher,
    isNegated,
    actualText,
    expectedText,
    expectedLiteral,
    node,
    line,
  };
}
export function scanFile(
  file: string,
  findings: Finding[],
  stats: ScanStats,
  tests: TestRec[],
): void {
  const src = readFileSync(file, 'utf8');
  const ext = file.split('.').pop() ?? '';
  const KIND_MAP: Record<string, ts.ScriptKind> = {
    ts: ts.ScriptKind.TS,
    tsx: ts.ScriptKind.TSX,
    js: ts.ScriptKind.JS,
    jsx: ts.ScriptKind.JSX,
  };
  const kind = KIND_MAP[ext] ?? ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  stats.files++;
  const diagnostics: ts.Diagnostic[] =
    (sf as unknown as { parseDiagnostics?: ts.Diagnostic[] })
      .parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    stats.errors++;
    if (stats.errorFiles.length < 10) {
      const msg = ts.flattenDiagnosticMessageText(
        diagnostics[0].messageText,
        '\n',
      );
      stats.errorFiles.push(
        `${file}: ${diagnostics.length} parse diagnostic(s), first: ${msg.slice(0, 100)}`,
      );
    }
  }
  const contract = file.startsWith('scripts/tests');
  let varInits = new Map<string, string>();
  const fileReadPaths: string[] = [];
  let cur: TestRec | null = null;
  // Mock literals configured in beforeEach/beforeAll/file scope (when
  // cur is null) are collected per-suite and merged into tests that
  // belong to that suite or a descendant suite. File-scope literals
  // (collected when suiteStack is empty) apply to all tests.
  const setupMockLits: string[] = [];
  // Per-suite mock literals: key is the full suite path (dpath), value
  // is the list of literals configured in that suite's beforeEach/beforeAll.
  const suiteMockLits = new Map<string, string[]>();
  // Stack of current suite paths for scoping setup literals.
  const suiteStack: string[] = [];

  // Collect named function declarations for fnBody() lookup, and track
  // which ones are actually referenced as it()/test() callbacks so we
  // only skip those during traversal (not all named functions).
  const namedFunctions = new Map<string, ts.FunctionLikeDeclaration>();
  const usedAsTestCallback = new Set<string>();
  function collectNamedFunctions(node: ts.Node): void {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name
    ) {
      namedFunctions.set(node.name.text, node);
    }
    // Detect it('name', namedFunc) / test('name', namedFunc) references
    if (ts.isCallExpression(node)) {
      const chain = unwrapCallChain(node);
      if (chain && TEST_ROOTS.has(chain.root)) {
        const arg = node.arguments[chain.suffixes.length > 0 ? 1 : 1];
        if (arg && ts.isIdentifier(arg)) {
          usedAsTestCallback.add(arg.text);
        }
      }
    }
    ts.forEachChild(node, collectNamedFunctions);
  }
  collectNamedFunctions(sf);
  function findNamedFunction(
    name: string,
  ): ts.FunctionLikeDeclaration | undefined {
    return namedFunctions.get(name);
  }

  const push = (node: ts.Node, flag: string, detail: string): void => {
    findings.push({
      file,
      line:
        node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
          .line + 1,
      test: cur?.name ?? '',
      flag,
      detail: detail.replace(/\s+/g, ' ').slice(0, 200),
      area: areaOf(file),
    });
  };

  function analyzeExpect(
    ex: ExpectInfo,
    inCatch: boolean,
    inTimer: boolean,
  ): void {
    if (inCatch)
      push(
        ex.node,
        'SWALLOWED_ASSERT',
        'assertion inside catch handler (may be swallowed without rethrow)',
      );
    if (inTimer)
      push(
        ex.node,
        'TIMER_ASSERT',
        'assertion inside setTimeout/setInterval callback',
      );

    const actualLit = literalOfText(ex.actualText);
    if (
      !ex.isNegated &&
      ex.expectedLiteral !== null &&
      actualLit !== null &&
      actualLit === ex.expectedLiteral &&
      EQUALITY_MATCHERS.test(ex.matcher)
    ) {
      push(
        ex.node,
        'ALWAYS_TRUE',
        `expect(${actualLit}).${ex.matcher}(${ex.expectedLiteral}) — literal equals itself`,
      );
    }
    if (
      !ex.isNegated &&
      ex.matcher === 'toBeGreaterThanOrEqual' &&
      ex.expectedLiteral === '0' &&
      /\.length$/.test(ex.actualText)
    ) {
      push(ex.node, 'ALWAYS_TRUE', `${ex.actualText} >= 0 is always true`);
    }
    const expArgNode = ex.node.arguments[0];
    if (
      !ex.isNegated &&
      EQUALITY_MATCHERS.test(ex.matcher) &&
      expArgNode &&
      // Normalize both sides to text and compare — catches
      // expect(x).toBe(x), expect(obj.v).toBe(obj.v),
      // expect(result).toEqual(result), etc.
      // Exclude literal operands (those are ALWAYS_TRUE, not SELF_COMPARE).
      // Also exclude object/array literals — toBe on distinct literals
      // always fails (different references), so it's not a false green.
      !ts.isStringLiteralLike(expArgNode) &&
      !ts.isNumericLiteral(expArgNode) &&
      !ts.isObjectLiteralExpression(expArgNode) &&
      !ts.isArrayLiteralExpression(expArgNode) &&
      // Only flag when the actual is a simple identifier or member
      // access — a genuine shared reference.
      isPlainActual(ex.actualText) &&
      ex.actualText.trim() === ex.expectedText.trim()
    ) {
      push(
        ex.node,
        'SELF_COMPARE',
        `expect(${ex.actualText.trim()}).${ex.matcher}(${ex.expectedText.trim()}) on the same expression — always true`,
      );
    }
    if (ex.expectedLiteral === null) {
      const expArg = ex.node.arguments[0];
      if (expArg && ts.isIdentifier(expArg)) {
        const init = varInits.get(expArg.text);
        if (init && init.trim() === ex.actualText.trim()) {
          push(
            ex.node,
            'SELF_CONFIRMING',
            `expected '${expArg.text}' computed from the same call under test: ${init.trim().slice(0, 60)}`,
          );
        }
      } else if (
        expArg &&
        ts.isCallExpression(expArg) &&
        expArg.getText().trim() === ex.actualText.trim()
      ) {
        push(
          ex.node,
          'SELF_CONFIRMING',
          'expected re-invokes the same call as actual',
        );
      }
    }
  }

  function postProcess(): void {
    const rec = cur;
    if (!rec) return;
    // Merge setup-scope mock literals: file-scope literals apply to all
    // tests; per-suite literals apply only to tests in that suite or a
    // descendant suite. This prevents a beforeEach in one describe from
    // contaminating sibling describes.
    const mockLits = [...rec.mockLits, ...setupMockLits];
    // Add per-suite literals from ancestor suites only. Use boundary-aware
    // matching (exact equality or `suitePath > ` prefix) to avoid
    // prefix-collision false positives (e.g., "Suite A" matching "Suite AB").
    for (const [suitePath, lits] of suiteMockLits) {
      if (rec.name === suitePath || rec.name.startsWith(`${suitePath} > `)) {
        mockLits.push(...lits);
      }
    }
    const { expects, stringAsserts } = rec;

    if (
      expects.length === 0 &&
      !/expect\(|fc\.assert|\.rejects|\.resolves|toThrow\(|assert\(|assert\.ok|assert\.equal|assert\.strictEqual|assert\.deepEqual|assert\.throws|assert\.doesNotThrow|assert\.notStrictEqual|assert\.notDeepEqual|assert\.fail|assert\.true|assert\.false|assert\.isNull|assert\.isNotNull|assert\.isUndefined|assert\.isDefined/.test(
        stripComments(rec.body.getText()),
      )
    ) {
      // For expression-bodied callbacks, rec.body is a ConciseBody (not a
      // Block) and has no .statements array. Use getText() directly.
      let consoleOnly = false;
      if (ts.isBlock(rec.body)) {
        const stmts = rec.body.statements
          .map((s) => s.getText().trim())
          .filter((s) => !s.startsWith('//'));
        consoleOnly =
          stmts.length > 0 && stmts.every((s) => /^console\./.test(s));
      } else {
        const text = rec.body.getText().trim();
        consoleOnly = /^console\./.test(text);
      }
      push(
        rec.body,
        'NO_ASSERT',
        consoleOnly ? 'test body only logs' : 'no assertions found',
      );
      return;
    }
    const real = expects.filter(
      (e) => !WEAK_MATCHERS.has(e.matcher) && !SNAPSHOT_MATCHERS.has(e.matcher),
    );
    if (
      real.length === 0 &&
      expects.length > 0 &&
      expects.some((e) => WEAK_MATCHERS.has(e.matcher))
    ) {
      push(
        rec.body,
        'WEAK_ONLY',
        'only weak matchers (toBeDefined/toBeTruthy/...)',
      );
    }
    if (
      expects.length > 0 &&
      expects.every((e) => SNAPSHOT_MATCHERS.has(e.matcher))
    ) {
      push(rec.body, 'SNAPSHOT_ONLY', 'snapshot is the only assertion');
    }
    if (
      expects.length > 0 &&
      expects.every((e) => CALL_MATCHERS.test(e.matcher)) &&
      /mock\(|jest\.fn|vi\.fn/.test(rec.body.getText())
    ) {
      push(
        rec.body,
        'MOCK_ONLY_ORACLE',
        'all assertions verify calls on locally-created doubles (wiring, not behavior)',
      );
    }
    if (mockLits.length > 0) {
      const shared = new Set(
        mockLits.filter((m) => expects.some((e) => e.expectedLiteral === m)),
      );
      if (
        shared.size > 0 &&
        expects.some(
          (e) =>
            e.expectedLiteral !== null &&
            shared.has(e.expectedLiteral) &&
            !e.isNegated &&
            ['toBe', 'toEqual', 'toStrictEqual', 'toMatchObject'].includes(
              e.matcher,
            ) &&
            isPlainActual(e.actualText),
        )
      ) {
        push(
          rec.body,
          'MOCK_MIRROR',
          `stub is configured with, and test asserts, the same literal: ${[...shared].slice(0, 2).join(', ')}`,
        );
      }
    }
    const structural = expects.every((e) => {
      const t = e.expectedLiteral ?? '';
      return (
        /^"(function|object|string|number|boolean|symbol|bigint|undefined)"$/.test(
          t,
        ) ||
        /^typeof\s/.test(e.actualText) ||
        /^Object\.(keys|values|getOwnPropertyNames)\(/.test(e.actualText)
      );
    });
    if (structural && expects.length > 0)
      push(
        rec.body,
        'STRUCTURE_ONLY',
        'assertions only check types/shape/exports, not behavior',
      );

    const seen = new Map<string, number>();
    for (const e of expects) {
      const norm = e.node.getText().replace(/\s+/g, ' ');
      seen.set(norm, (seen.get(norm) ?? 0) + 1);
    }
    for (const [norm, n] of seen)
      if (n > 1)
        push(
          rec.body,
          'DUP_ASSERT',
          `${n}x identical assertion: ${norm.slice(0, 90)}`,
        );

    if (fileReadPaths.length > 0 && stringAsserts.length > 0) {
      outer: for (const rel of fileReadPaths) {
        const target = resolve(dirname(file), rel);
        if (
          !existsSync(target) ||
          /fixtures|__snapshots__|node_modules/.test(target) ||
          /\.(test|spec)\./.test(target)
        )
          continue;
        // The path literal is parsed from arbitrary source text and may name a
        // directory or vanish mid-scan; treat both as "nothing to compare".
        let targetStat: ReturnType<typeof statSync> | undefined;
        try {
          targetStat = statSync(target);
        } catch {
          continue;
        }
        if (!targetStat.isFile()) continue;
        let content: string;
        try {
          content = readFileSync(target, 'utf8');
        } catch {
          continue;
        }
        for (const lit of stringAsserts) {
          if (lit.length >= 6 && content.includes(lit)) {
            push(
              rec.body,
              'SOURCE_MIRROR',
              `asserts literal verbatim present in read file ${rel}${contract ? ' [contract-test dir: likely intentional]' : ''}`,
            );
            break outer;
          }
        }
      }
    }
  }

  function fnBody(n: ts.CallExpression): ts.Block | ts.ConciseBody | null {
    const fn = [...n.arguments].reverse().find(
      (a) =>
        ts.isFunctionExpression(a) ||
        ts.isArrowFunction(a) ||
        ts.isIdentifier(a), // named callback reference
    ) as ts.FunctionExpression | ts.ArrowFunction | ts.Identifier | undefined;

    // Named callback: look up the function declaration in the same source
    // file and use its body.
    if (fn && ts.isIdentifier(fn)) {
      const decl = findNamedFunction(fn.text);
      if (decl) {
        const body: ts.ConciseBody | undefined = decl.body;
        if (body && ts.isBlock(body)) return body;
        // Expression-bodied function
        return body ?? null;
      }
      return null;
    }
    if (!fn) return null;
    // Block-bodied: return the block.
    if (ts.isBlock(fn.body)) return fn.body;
    // Expression-bodied arrow function: return the expression body.
    return fn.body;
  }
  const labelOf = (n: ts.CallExpression): string => {
    const a = n.arguments.find((x) => ts.isStringLiteralLike(x)) as
      | ts.StringLiteralLike
      | undefined;
    return a?.text ?? '(unnamed)';
  };

  function visit(
    node: ts.Node,
    dpath: string,
    inCatch: boolean,
    inTimer: boolean,
  ): void {
    // Skip named function declarations that are indexed as callbacks —
    // they will be traversed when the it()/test() call that references
    // them is visited. This prevents double-counting assertions and
    // emitting findings with blank test names.
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      namedFunctions.has(node.name.text) &&
      usedAsTestCallback.has(node.name.text)
    ) {
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const initText = node.initializer?.getText() ?? '';
      varInits.set(node.name.text, initText);
      // Index variable-bound callbacks (arrow functions or function
      // expressions assigned to a const/let) so that `it('name', callback)`
      // can resolve them. This catches the common pattern:
      //   const cb = () => { expect(x).toBe(y) };
      //   it('test', cb);
      if (
        node.initializer &&
        (ts.isArrowFunction(node.initializer) ||
          ts.isFunctionExpression(node.initializer))
      ) {
        namedFunctions.set(node.name.text, node.initializer);
        // Do NOT traverse the callback body here — it will be traversed
        // when the it()/test() call that references it is visited. This
        // prevents double-counting assertions and findings.
        return;
      }
      // For non-function initializers (e.g., vi.fn().mockReturnValue('X')),
      // fall through to visit children so mock configs are detected.
    }

    if (ts.isCallExpression(node)) {
      const chain = unwrapCallChain(node);

      if (chain && DESCRIBE_ROOTS.has(chain.root)) {
        const b = fnBody(node);
        if (b) {
          const suitePath = dpath
            ? `${dpath} > ${labelOf(node)}`
            : labelOf(node);
          suiteStack.push(suitePath);
          visit(b, suitePath, inCatch, inTimer);
          suiteStack.pop();
          return;
        }
      }
      if (
        chain &&
        TEST_ROOTS.has(chain.root) &&
        !chain.suffixes.includes('todo')
      ) {
        const b = fnBody(node);
        if (b) {
          const prev = cur;
          const label = labelOf(node);
          const name = dpath ? `${dpath} > ${label}` : label;
          stats.tests++;
          cur = {
            file,
            name,
            body: b,
            expects: [],
            mockLits: [],
            stringAsserts: [],
          };
          const savedVarInits = new Map(varInits);
          const savedFileReadPaths = [...fileReadPaths];
          tests.push(cur);
          if (ts.isBlock(b)) {
            visit(b, dpath, inCatch, inTimer);
          } else {
            // Expression-bodied arrow: visit the expression directly
            visit(b, dpath, inCatch, inTimer);
          }
          postProcess();
          varInits.clear();
          varInits = savedVarInits;
          fileReadPaths.length = 0;
          fileReadPaths.push(...savedFileReadPaths);
          cur = prev;
          return;
        }
      }

      const calleeText = node.expression.getText();
      if (
        /(^|\.)readFileSync$/.test(calleeText) ||
        /(^|\.)Bun\.file$/.test(calleeText)
      ) {
        const lit = stableLiteral(node.arguments[0]);
        if (lit && /^"[\s\S]*"$/.test(lit)) fileReadPaths.push(JSON.parse(lit));
      }

      if (
        ts.isPropertyAccessExpression(node.expression) &&
        MOCK_CONFIG.has(node.expression.name.text)
      ) {
        const lit = stableLiteral(node.arguments[0]);
        if (lit) {
          if (cur) {
            cur.mockLits.push(lit);
          } else {
            // Only file-scope mocks (no enclosing describe) go into the
            // global setupMockLits that applies to every test. Mocks
            // configured inside a describe/beforeEach go only into
            // suiteMockLits for that suite and its descendants.
            const currentSuite = suiteStack[suiteStack.length - 1];
            if (currentSuite) {
              const list = suiteMockLits.get(currentSuite) ?? [];
              list.push(lit);
              suiteMockLits.set(currentSuite, list);
            } else {
              setupMockLits.push(lit);
            }
          }
        }
      }

      const ex = matchExpectChain(node);
      if (ex) {
        stats.asserts++;
        if (cur) {
          cur.expects.push(ex);
          if (
            ['toContain', 'toBe', 'toEqual', 'toMatch'].includes(ex.matcher) &&
            ex.expectedLiteral?.startsWith('"')
          ) {
            cur.stringAsserts.push(JSON.parse(ex.expectedLiteral));
          }
        }
        analyzeExpect(ex, inCatch, inTimer);
        return;
      }

      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'expect'
      ) {
        const parent = node.parent;
        if (
          ts.isExpressionStatement(parent) ||
          (ts.isPropertyAccessExpression(parent) &&
            !ts.isCallExpression(parent.parent))
        ) {
          push(
            node,
            'EXPECT_NO_MATCHER',
            `expect(${node.arguments[0]?.getText() ?? ''}) never calls a matcher`,
          );
        }
      }

      if (/^(setTimeout|setInterval)$/.test(calleeText)) {
        const cb = node.arguments.find(
          (a) => ts.isFunctionExpression(a) || ts.isArrowFunction(a),
        );
        if (cb) {
          visit(cb, dpath, inCatch, true);
          return;
        }
      }
    }

    if (ts.isCatchClause(node)) {
      visit(node.block, dpath, true, inTimer);
      return;
    }

    // Treat .catch() callback handlers as catch-context for
    // SWALLOWED_ASSERT detection, matching the idiomatic async pattern.
    if (ts.isCallExpression(node)) {
      const calleeText = node.expression.getText();
      if (/\.catch$/.test(calleeText)) {
        const catchCb = node.arguments.find(ts.isFunctionLike);
        if (catchCb) {
          visit(catchCb, dpath, true, inTimer);
          return;
        }
      }
    }

    ts.forEachChild(node, (c) => visit(c, dpath, inCatch, inTimer));
  }

  ts.forEachChild(sf, (c) => visit(c, '', false, false));
}

export function runScan(
  roots: string[] = DEFAULT_ROOTS,
  outDir: string = DEFAULT_OUT_DIR,
): ScanResult {
  const files: string[] = [];
  for (const r of roots) collectTestFiles(r, files);
  const findings: Finding[] = [];
  const stats: ScanStats = {
    files: 0,
    tests: 0,
    asserts: 0,
    errors: 0,
    errorFiles: [],
  };
  const tests: TestRec[] = [];
  for (const f of files) {
    scanFile(f, findings, stats, tests);
  }

  const perFile = new Map<string, { tests: number; asserts: number }>();
  for (const t of tests) {
    const e = perFile.get(t.file) ?? { tests: 0, asserts: 0 };
    e.tests++;
    e.asserts += t.expects.length;
    perFile.set(t.file, e);
  }

  mkdirSync(outDir, { recursive: true });
  const header = 'file\tline\ttest\tflag\tdetail\tarea';
  const rows = findings.map((f) =>
    [f.file, f.line, f.test, f.flag, f.detail, f.area]
      .map((c) => String(c).replace(/\t|\n/g, ' '))
      .join('\t'),
  );
  writeFileSync(join(outDir, 'findings.tsv'), [header, ...rows].join('\n'));
  writeFileSync(
    join(outDir, 'file-stats.tsv'),
    [
      'file\ttests\tasserts',
      ...[...perFile].map(([f, v]) => `${f}\t${v.tests}\t${v.asserts}`),
    ].join('\n'),
  );

  return { findings, stats, perFile };
}

function printSummary(result: ScanResult): void {
  const { findings, stats, perFile } = result;
  const byFlag = new Map<string, number>();
  for (const f of findings) byFlag.set(f.flag, (byFlag.get(f.flag) ?? 0) + 1);
  const byArea = new Map<string, number>();
  for (const f of findings) byArea.set(f.area, (byArea.get(f.area) ?? 0) + 1);

  console.log(`files scanned: ${stats.files}  errors: ${stats.errors}`);
  for (const e of stats.errorFiles) console.log(`  ERR ${e}`);
  console.log(
    `tests: ${stats.tests}  assertions: ${stats.asserts}  (avg ${(stats.asserts / Math.max(1, stats.tests)).toFixed(2)} asserts/test)`,
  );
  console.log(`findings: ${findings.length}`);
  console.log('\n== by flag ==');
  for (const [k, v] of [...byFlag].sort((a, b) => b[1] - a[1]))
    console.log(`${String(v).padStart(6)}  ${k}`);
  console.log('\n== by area ==');
  for (const [k, v] of [...byArea].sort((a, b) => b[1] - a[1]).slice(0, 18))
    console.log(`${String(v).padStart(6)}  ${k}`);
  console.log(
    `\nper-file stats for ${perFile.size} files written alongside findings.tsv`,
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    console.log(
      'usage: bun scripts/test-audit/scan.ts [outDir]   (defaults: tmp/test-audit; scans packages, scripts/tests, integration-tests)',
    );
    process.exit(0);
  }
  const outDir = args[0] ?? DEFAULT_OUT_DIR;
  printSummary(runScan(DEFAULT_ROOTS, outDir));
}

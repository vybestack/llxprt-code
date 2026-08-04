/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Converts Bun JUnit XML test reports into the Vitest-compatible JSON report
 * shape consumed by `scripts/aggregate-evals-schema.ts`.
 *
 * Bun's `--reporter=junit --reporter-outfile=<path>` emits a standard JUnit
 * XML file with `<testsuites>`, `<testsuite>`, and `<testcase>` elements.
 * Bun nests testsuites: a file-level `<testsuite>` contains describe-level
 * `<testsuite>` elements, which in turn contain `<testcase>` elements.
 *
 * This module extracts only DIRECT testcase children of each testsuite (not
 * those nested inside child testsuites), so tests are not double-counted.
 * Testsuites with no direct testcases (the file-level wrapper) are omitted
 * from the report, matching the Vitest JSON reporter's behaviour.
 *
 * All functions are pure and independently testable.
 */

/**
 * Recognized assertion status values (must match `aggregate-evals-schema.ts`).
 */
export const USABLE_STATUSES = new Set(['passed', 'failed']);
export const NON_DENOMINATOR_STATUSES = new Set(['skipped', 'pending', 'todo']);
export const RECOGNIZED_STATUSES = new Set([
  ...USABLE_STATUSES,
  ...NON_DENOMINATOR_STATUSES,
]);
export const RECOGNIZED_SUITE_STATUSES = new Set(['passed', 'failed']);

/**
 * Shape of a single assertion result in the Vitest JSON report.
 */
export interface AssertionResult {
  readonly title: string;
  readonly fullName: string;
  readonly status: string;
}

/**
 * Shape of a single test result (suite) in the Vitest JSON report.
 */
export interface TestResult {
  readonly name: string;
  readonly status: string;
  readonly assertionResults: readonly AssertionResult[];
}

/**
 * The complete Vitest-compatible JSON report shape.
 */
export interface VitestJsonReport {
  readonly numTotalTests: number;
  readonly numPassedTests: number;
  readonly numFailedTests: number;
  readonly numPendingTests: number;
  readonly numTodoTests: number;
  readonly numTotalTestSuites: number;
  readonly numPassedTestSuites: number;
  readonly numFailedTestSuites: number;
  readonly numPendingTestSuites: number;
  readonly success: boolean;
  readonly testResults: readonly TestResult[];
}

/**
 * A parsed JUnit testcase element (the fields we extract).
 */
export interface JUnitTestCase {
  readonly classname: string;
  readonly name: string;
  readonly time: string | null;
  readonly status: 'passed' | 'failed' | 'skipped' | 'todo';
  readonly failureMessage: string | null;
}

/**
 * A parsed JUnit testsuite element.
 */
export interface JUnitTestSuite {
  readonly name: string;
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly skipped: number;
  readonly testCases: readonly JUnitTestCase[];
}

/**
 * A parsed JUnit testsuites (root) element.
 */
export interface JUnitTestSuites {
  readonly name: string;
  readonly tests: number;
  readonly failures: number;
  readonly errors: number;
  readonly suites: readonly JUnitTestSuite[];
}

function parseIntOrDefault(value: string | null, defaultValue: number): number {
  if (value === null) return defaultValue;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Extracts an attribute value from an XML tag string.
 * Returns null when the attribute is absent.
 */
function extractAttr(tagText: string, attrName: string): string | null {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, 'i');
  const match = regex.exec(tagText);
  return match ? match[1] : null;
}

/**
 * Represents a parsed XML element: its opening tag text, the inner content
 * (between open and close tags), and whether it is self-closing.
 */
interface ParsedElement {
  readonly openTag: string;
  readonly innerContent: string;
  readonly selfClosing: boolean;
  readonly fullText: string;
}

/**
 * Finds the matching closing tag for an opening tag at the given position.
 * Tracks depth to handle nested elements of the same tag name. Returns the
 * position just past the closing tag, or -1 if not found.
 */
function findMatchingCloseTag(
  xml: string,
  openTagEnd: number,
  tagName: string,
): number {
  const closeTag = `</${tagName}>`;
  const openTagPrefix = `<${tagName} `;
  let depth = 1;
  let pos = openTagEnd;
  while (depth > 0 && pos < xml.length) {
    const nextOpen = xml.indexOf(openTagPrefix, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 1;
    } else {
      depth--;
      pos = nextClose + closeTag.length;
    }
  }
  return pos;
}

/**
 * Extracts all DIRECT child elements with the given tag name from an XML
 * block. Direct children are at depth 1 relative to the block — elements
 * nested inside child elements of the same tag are NOT included.
 */
function extractDirectChildren(xml: string, tagName: string): ParsedElement[] {
  const results: ParsedElement[] = [];
  const openRegex = new RegExp(`<${tagName}\\b[^>]*?(/?)>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(xml)) !== null) {
    const openTag = match[0];
    const selfClosing = match[1] === '/';
    const startIndex = match.index;
    if (selfClosing) {
      results.push({
        openTag,
        innerContent: '',
        selfClosing: true,
        fullText: openTag,
      });
      continue;
    }
    const elementResult = parseNonSelfClosingChild(
      xml,
      tagName,
      startIndex,
      openTag,
    );
    results.push(elementResult.element);
    openRegex.lastIndex = elementResult.endPos;
    if (elementResult.malformed) return results;
  }
  return results;
}

interface ExtractedChild {
  readonly element: ParsedElement;
  readonly endPos: number;
  readonly malformed: boolean;
}

function parseNonSelfClosingChild(
  xml: string,
  tagName: string,
  startIndex: number,
  openTag: string,
): ExtractedChild {
  const openEnd = startIndex + openTag.length;
  const closeEnd = findMatchingCloseTag(xml, openEnd, tagName);
  if (closeEnd === -1) {
    return {
      element: {
        openTag,
        innerContent: xml.slice(openEnd),
        selfClosing: false,
        fullText: xml.slice(startIndex),
      },
      endPos: xml.length,
      malformed: true,
    };
  }
  const closeTag = `</${tagName}>`;
  const innerContent = xml.slice(openEnd, closeEnd - closeTag.length);
  return {
    element: {
      openTag,
      innerContent,
      selfClosing: false,
      fullText: xml.slice(startIndex, closeEnd),
    },
    endPos: closeEnd,
    malformed: false,
  };
}

/**
 * Extracts the inner content of an XML element (between open and close tags).
 */
function extractInnerContent(xml: string, tagName: string): string {
  const openRegex = new RegExp(`<${tagName}\\b[^>]*?(/?)>`, 'i');
  const openMatch = openRegex.exec(xml);
  if (openMatch === null) return '';
  if (openMatch[1] === '/') return '';
  const start = openMatch.index + openMatch[0].length;
  const closeTag = `</${tagName}>`;
  const end = xml.lastIndexOf(closeTag);
  if (end === -1 || end < start) return '';
  return xml.slice(start, end);
}

/**
 * Parse a single `<testcase>` XML element into a `JUnitTestCase`.
 */
export function parseTestCaseElement(element: ParsedElement): JUnitTestCase {
  const openTag = element.openTag;
  const classname = decodeXmlEntities(extractAttr(openTag, 'classname') ?? '');
  const name = decodeXmlEntities(extractAttr(openTag, 'name') ?? '');
  const time = extractAttr(openTag, 'time');

  const fullText = element.fullText;
  const hasSkipped = /<skipped\b/i.test(fullText);
  const hasFailure = /<failure\b/i.test(fullText);
  const hasError = /<error\b/i.test(fullText);

  let status: JUnitTestCase['status'] = 'passed';
  let failureMessage: string | null = null;

  if (hasSkipped) {
    status = 'skipped';
    const skippedMatch = /<skipped\b[^>]*>/i.exec(fullText);
    if (skippedMatch !== null) {
      failureMessage = extractAttr(skippedMatch[0], 'message');
    }
  } else if (hasFailure) {
    status = 'failed';
    const failureMatch = /<failure\b[^>]*>/i.exec(fullText);
    if (failureMatch !== null) {
      failureMessage = extractAttr(failureMatch[0], 'message');
    }
  } else if (hasError) {
    status = 'failed';
    const errorMatch = /<error\b[^>]*>/i.exec(fullText);
    if (errorMatch !== null) {
      failureMessage = extractAttr(errorMatch[0], 'message');
    }
  }

  return { classname, name, time, status, failureMessage };
}

/**
 * Parse a single `<testsuite>` XML element into a `JUnitTestSuite`.
 * Only DIRECT `<testcase>` children are extracted (not those inside nested
 * `<testsuite>` elements), preventing double-counting.
 */
export function parseTestSuiteElement(element: ParsedElement): JUnitTestSuite {
  const openTag = element.openTag;
  const name = decodeXmlEntities(extractAttr(openTag, 'name') ?? '');
  const tests = parseIntOrDefault(extractAttr(openTag, 'tests'), 0);
  const failures = parseIntOrDefault(extractAttr(openTag, 'failures'), 0);
  const errors = parseIntOrDefault(extractAttr(openTag, 'errors'), 0);
  const skipped = parseIntOrDefault(extractAttr(openTag, 'skipped'), 0);

  const caseElements = extractDirectChildren(element.innerContent, 'testcase');
  const testCases = caseElements.map(parseTestCaseElement);

  return { name, tests, failures, errors, skipped, testCases };
}

/**
 * Parse a JUnit XML string into a `JUnitTestSuites` structure.
 * All testsuites at any nesting level are flattened into a single list.
 * Testsuites with zero direct testcases (the file-level wrapper) are
 * included in the parse but will produce empty assertion lists in the
 * report — the caller can filter them out via `buildVitestJsonReport`.
 */
export function parseJUnitXml(xml: string): JUnitTestSuites {
  const rootOpenMatch = /<testsuites\b[^>]*?(\/?)>/i.exec(xml);
  if (rootOpenMatch === null) {
    throw new Error('Invalid JUnit XML: expected <testsuites> root element');
  }
  const rootOpenTag = rootOpenMatch[0];
  const name = decodeXmlEntities(extractAttr(rootOpenTag, 'name') ?? '');
  const tests = parseIntOrDefault(extractAttr(rootOpenTag, 'tests'), 0);
  const failures = parseIntOrDefault(extractAttr(rootOpenTag, 'failures'), 0);
  const errors = parseIntOrDefault(extractAttr(rootOpenTag, 'errors'), 0);

  const innerContent = extractInnerContent(xml, 'testsuites');
  // Recursively collect ALL testsuite elements (including nested ones)
  const allSuites = collectAllTestSuites(innerContent);

  return { name, tests, failures, errors, suites: allSuites };
}

/**
 * Recursively collects all testsuite elements from the given XML content,
 * flattening nested suites into a single list.
 */
function collectAllTestSuites(xml: string): JUnitTestSuite[] {
  const suites: JUnitTestSuite[] = [];
  const topSuites = extractDirectChildren(xml, 'testsuite');
  for (const suiteElement of topSuites) {
    suites.push(parseTestSuiteElement(suiteElement));
    // Recursively collect nested testsuites
    const nestedSuites = collectAllTestSuites(suiteElement.innerContent);
    suites.push(...nestedSuites);
  }
  return suites;
}

/**
 * Convert a `JUnitTestCase` into a Vitest-compatible `AssertionResult`.
 *
 * The `title` is the test name; the `fullName` is `classname name` (space-joined,
 * matching the Vitest JSON reporter convention the aggregator expects).
 */
export function testCaseToAssertion(testCase: JUnitTestCase): AssertionResult {
  return {
    title: testCase.name,
    fullName:
      testCase.classname.length > 0
        ? `${testCase.classname} ${testCase.name}`.trim()
        : testCase.name,
    status: testCase.status === 'skipped' ? 'skipped' : testCase.status,
  };
}

/**
 * Determine the suite-level status from its assertions. A suite is `failed`
 * when at least one assertion failed; otherwise `passed`.
 */
export function suiteStatus(assertions: readonly AssertionResult[]): string {
  for (const assertion of assertions) {
    if (assertion.status === 'failed') {
      return 'failed';
    }
  }
  return 'passed';
}

/**
 * Convert a `JUnitTestSuite` into a Vitest-compatible `TestResult`.
 * Testsuites with zero testcases produce an empty assertion list but
 * are still represented (they count towards numTotalTestSuites).
 */
export function testSuiteToTestResult(testSuite: JUnitTestSuite): TestResult {
  const assertionResults = testSuite.testCases.map(testCaseToAssertion);
  const status = suiteStatus(assertionResults);
  return {
    name: testSuite.name,
    status,
    assertionResults,
  };
}

/**
 * Build the complete Vitest-compatible JSON report from a parsed JUnit
 * `JUnitTestSuites` structure.
 *
 * Testsuites with zero testcases (the file-level wrapper in Bun's JUnit
 * format) are filtered out — they carry no per-test signal and would
 * inflate numTotalTestSuites without contributing assertion results.
 */
export function buildVitestJsonReport(
  junit: JUnitTestSuites,
): VitestJsonReport {
  const allSuiteResults = junit.suites.map(testSuiteToTestResult);
  // Filter out suites with zero assertions (file-level wrappers)
  const testResults = allSuiteResults.filter(
    (r) => r.assertionResults.length > 0,
  );
  let numPassedTests = 0;
  let numFailedTests = 0;
  let numPendingTests = 0;
  let numTodoTests = 0;
  let numPassedTestSuites = 0;
  let numFailedTestSuites = 0;
  let numPendingTestSuites = 0;

  for (const result of testResults) {
    if (result.status === 'passed') {
      numPassedTestSuites++;
    } else if (result.status === 'failed') {
      numFailedTestSuites++;
    } else {
      numPendingTestSuites++;
    }
    for (const assertion of result.assertionResults) {
      if (assertion.status === 'passed') {
        numPassedTests++;
      } else if (assertion.status === 'failed') {
        numFailedTests++;
      } else if (assertion.status === 'skipped') {
        numPendingTests++;
      } else if (assertion.status === 'todo') {
        numTodoTests++;
      }
    }
  }

  return {
    numTotalTests:
      numPassedTests + numFailedTests + numPendingTests + numTodoTests,
    numPassedTests,
    numFailedTests,
    numPendingTests,
    numTodoTests,
    numTotalTestSuites: testResults.length,
    numPassedTestSuites,
    numFailedTestSuites,
    numPendingTestSuites,
    success: numFailedTests === 0,
    testResults,
  };
}

/**
 * Parse a JUnit XML string and produce the full Vitest-compatible JSON report.
 * This is the top-level entry point for the runner.
 */
export function junitXmlToVitestJson(xml: string): VitestJsonReport {
  return buildVitestJsonReport(parseJUnitXml(xml));
}

/**
 * Validate a `VitestJsonReport` against the consistency rules in
 * `aggregate-evals-schema.ts`. Returns an array of error messages (empty
 * when valid).
 */
export function validateReportConsistency(
  report: VitestJsonReport,
  reportPath?: string,
): string[] {
  const errors: string[] = [];
  const path = reportPath ?? '<report>';

  let failedAssertions = 0;
  let represented = 0;

  for (const testResult of report.testResults) {
    let suiteFailed = 0;
    for (const assertion of testResult.assertionResults) {
      represented++;
      if (!RECOGNIZED_STATUSES.has(assertion.status)) {
        errors.push(
          `${path}: assertion "${assertion.fullName}" has unrecognized status "${assertion.status}"`,
        );
      }
      if (assertion.status === 'failed') {
        suiteFailed++;
        failedAssertions++;
      }
    }
    if (!RECOGNIZED_SUITE_STATUSES.has(testResult.status)) {
      errors.push(
        `${path}: testResult "${testResult.name}" has unrecognized status "${testResult.status}"`,
      );
    } else if (testResult.status === 'failed' && suiteFailed === 0) {
      errors.push(
        `${path}: testResult "${testResult.name}" is marked failed but has no failed assertions`,
      );
    } else if (testResult.status === 'passed' && suiteFailed > 0) {
      errors.push(
        `${path}: testResult "${testResult.name}" is marked passed but has ${suiteFailed} failed assertion(s)`,
      );
    }
  }

  if (report.success === false && failedAssertions === 0) {
    errors.push(
      `${path}: report.success is false but no assertions are failed`,
    );
  }
  if (report.success === true && report.numFailedTests > 0) {
    errors.push(
      `${path}: success is true but numFailedTests is ${report.numFailedTests}`,
    );
  }

  const sumComponents =
    report.numPassedTests +
    report.numFailedTests +
    report.numPendingTests +
    (report.numTodoTests ?? 0);
  if (report.numTotalTests !== sumComponents) {
    errors.push(
      `${path}: numTotalTests (${report.numTotalTests}) does not reconcile with components (${sumComponents})`,
    );
  }

  if (represented !== report.numTotalTests) {
    errors.push(
      `${path}: represented assertions (${represented}) do not equal numTotalTests (${report.numTotalTests})`,
    );
  }

  const sumSuiteComponents =
    report.numPassedTestSuites +
    report.numFailedTestSuites +
    report.numPendingTestSuites;
  if (report.numTotalTestSuites !== sumSuiteComponents) {
    errors.push(
      `${path}: numTotalTestSuites (${report.numTotalTestSuites}) does not reconcile with suite components (${sumSuiteComponents})`,
    );
  }

  return errors;
}

/**
 * Serialize a `VitestJsonReport` to a JSON string.
 */
export function serializeReport(report: VitestJsonReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseJUnitXml,
  buildVitestJsonReport,
  junitXmlToVitestJson,
  testCaseToAssertion,
  suiteStatus,
  testSuiteToTestResult,
  validateReportConsistency,
  serializeReport,
  type JUnitTestCase,
  type JUnitTestSuite,
  type VitestJsonReport,
} from '../bun-junit-to-json-report.js';

function makePassedTestCase(classname: string, name: string): JUnitTestCase {
  return {
    classname,
    name,
    time: '0',
    status: 'passed',
    failureMessage: null,
  };
}

function makeFailedTestCase(
  classname: string,
  name: string,
  message: string,
): JUnitTestCase {
  return {
    classname,
    name,
    time: '0',
    status: 'failed',
    failureMessage: message,
  };
}

function makeSkippedTestCase(classname: string, name: string): JUnitTestCase {
  return {
    classname,
    name,
    time: '0',
    status: 'skipped',
    failureMessage: null,
  };
}

function makeSuite(
  name: string,
  testCases: readonly JUnitTestCase[],
): JUnitTestSuite {
  return {
    name,
    tests: testCases.length,
    failures: testCases.filter((tc) => tc.status === 'failed').length,
    errors: 0,
    skipped: testCases.filter((tc) => tc.status === 'skipped').length,
    testCases,
  };
}

const simpleXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun tests" tests="2" failures="1" errors="0">
  <testsuite name="suite-a" tests="2" failures="1" errors="0" skipped="0" time="0">
    <testcase classname="suite-a" name="test-pass" time="0" />
    <testcase classname="suite-a" name="test-fail" time="0">
      <failure message="expected true to be false" />
    </testcase>
  </testsuite>
</testsuites>`;

const multiSuiteXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun tests" tests="4" failures="1" errors="0">
  <testsuite name="suite-a" tests="2" failures="0" errors="0" skipped="0" time="0">
    <testcase classname="suite-a" name="pass-1" time="0" />
    <testcase classname="suite-a" name="pass-2" time="0" />
  </testsuite>
  <testsuite name="suite-b" tests="2" failures="1" errors="0" skipped="1" time="0">
    <testcase classname="suite-b" name="skip-1" time="0">
      <skipped message="skipped" />
    </testcase>
    <testcase classname="suite-b" name="fail-1" time="0">
      <failure message="boom" />
    </testcase>
  </testsuite>
</testsuites>`;

const emptySuiteXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun tests" tests="0" failures="0" errors="0">
</testsuites>`;

const allPassedXml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun tests" tests="3" failures="0" errors="0">
  <testsuite name="suite-a" tests="3" failures="0" errors="0" skipped="0" time="0">
    <testcase classname="suite-a" name="pass-1" time="0" />
    <testcase classname="suite-a" name="pass-2" time="0" />
    <testcase classname="suite-a" name="pass-3" time="0" />
  </testsuite>
</testsuites>`;

describe('parseJUnitXml', () => {
  it('parses a simple JUnit XML with one suite and two testcases', () => {
    const result = parseJUnitXml(simpleXml);
    expect(result.name).toBe('bun tests');
    expect(result.suites).toHaveLength(1);
    expect(result.suites[0].name).toBe('suite-a');
    expect(result.suites[0].testCases).toHaveLength(2);
    expect(result.suites[0].testCases[0].status).toBe('passed');
    expect(result.suites[0].testCases[1].status).toBe('failed');
    expect(result.suites[0].testCases[1].failureMessage).toBe(
      'expected true to be false',
    );
  });

  it('parses multiple suites with skipped testcases', () => {
    const result = parseJUnitXml(multiSuiteXml);
    expect(result.suites).toHaveLength(2);
    expect(result.suites[1].testCases).toHaveLength(2);
    expect(result.suites[1].testCases[0].status).toBe('skipped');
    expect(result.suites[1].testCases[1].status).toBe('failed');
  });

  it('throws on invalid XML', () => {
    expect(() => parseJUnitXml('<not-xml')).toThrow(/Invalid JUnit XML/);
  });

  it('throws when root element is not testsuites', () => {
    expect(() => parseJUnitXml('<?xml version="1.0"?><foo bar="1"/>')).toThrow(
      /expected <testsuites>/,
    );
  });

  it('parses an empty testsuites element', () => {
    const result = parseJUnitXml(emptySuiteXml);
    expect(result.suites).toHaveLength(0);
    expect(result.tests).toBe(0);
  });
});

describe('testCaseToAssertion', () => {
  it('produces fullName from classname and name', () => {
    const assertion = testCaseToAssertion(
      makePassedTestCase('my-suite', 'my-test'),
    );
    expect(assertion.title).toBe('my-test');
    expect(assertion.fullName).toBe('my-suite my-test');
    expect(assertion.status).toBe('passed');
  });

  it('produces fullName equal to title when classname is empty', () => {
    const assertion = testCaseToAssertion(makePassedTestCase('', 'my-test'));
    expect(assertion.fullName).toBe('my-test');
    expect(assertion.title).toBe('my-test');
  });

  it('preserves skipped status', () => {
    const assertion = testCaseToAssertion(
      makeSkippedTestCase('suite', 'skipped-test'),
    );
    expect(assertion.status).toBe('skipped');
  });

  it('preserves failed status', () => {
    const assertion = testCaseToAssertion(
      makeFailedTestCase('suite', 'failed-test', 'err'),
    );
    expect(assertion.status).toBe('failed');
  });
});

describe('suiteStatus', () => {
  it('returns passed when all assertions pass', () => {
    const assertions = [
      testCaseToAssertion(makePassedTestCase('s', 'a')),
      testCaseToAssertion(makePassedTestCase('s', 'b')),
    ];
    expect(suiteStatus(assertions)).toBe('passed');
  });

  it('returns failed when any assertion fails', () => {
    const assertions = [
      testCaseToAssertion(makePassedTestCase('s', 'a')),
      testCaseToAssertion(makeFailedTestCase('s', 'b', 'err')),
    ];
    expect(suiteStatus(assertions)).toBe('failed');
  });

  it('returns passed for an empty assertion list', () => {
    expect(suiteStatus([])).toBe('passed');
  });

  it('returns passed when all assertions are skipped', () => {
    const assertions = [testCaseToAssertion(makeSkippedTestCase('s', 'a'))];
    expect(suiteStatus(assertions)).toBe('passed');
  });
});

describe('testSuiteToTestResult', () => {
  it('produces a TestResult with correct status and assertions', () => {
    const suite = makeSuite('my-suite', [
      makePassedTestCase('my-suite', 'a'),
      makeFailedTestCase('my-suite', 'b', 'err'),
    ]);
    const result = testSuiteToTestResult(suite);
    expect(result.name).toBe('my-suite');
    expect(result.status).toBe('failed');
    expect(result.assertionResults).toHaveLength(2);
  });

  it('produces a passed status when no failures', () => {
    const suite = makeSuite('my-suite', [
      makePassedTestCase('my-suite', 'a'),
      makeSkippedTestCase('my-suite', 'b'),
    ]);
    const result = testSuiteToTestResult(suite);
    expect(result.status).toBe('passed');
  });
});

describe('buildVitestJsonReport', () => {
  it('builds correct counters from a multi-suite JUnit structure', () => {
    const junit = parseJUnitXml(multiSuiteXml);
    const report = buildVitestJsonReport(junit);
    expect(report.numTotalTests).toBe(4);
    expect(report.numPassedTests).toBe(2);
    expect(report.numFailedTests).toBe(1);
    expect(report.numPendingTests).toBe(1);
    expect(report.numTodoTests).toBe(0);
    expect(report.numTotalTestSuites).toBe(2);
    expect(report.numPassedTestSuites).toBe(1);
    expect(report.numFailedTestSuites).toBe(1);
    expect(report.numPendingTestSuites).toBe(0);
    expect(report.success).toBe(false);
    expect(report.testResults).toHaveLength(2);
  });

  it('reports success=true when no failures', () => {
    const junit = parseJUnitXml(allPassedXml);
    const report = buildVitestJsonReport(junit);
    expect(report.success).toBe(true);
    expect(report.numFailedTests).toBe(0);
    expect(report.numPassedTests).toBe(3);
    expect(report.numFailedTestSuites).toBe(0);
  });

  it('handles empty testsuites', () => {
    const junit = parseJUnitXml(emptySuiteXml);
    const report = buildVitestJsonReport(junit);
    expect(report.numTotalTests).toBe(0);
    expect(report.testResults).toHaveLength(0);
    expect(report.success).toBe(true);
  });
});

describe('junitXmlToVitestJson (end-to-end)', () => {
  it('converts XML string to full report in one call', () => {
    const report = junitXmlToVitestJson(simpleXml);
    expect(report.testResults).toHaveLength(1);
    expect(report.testResults[0].assertionResults).toHaveLength(2);
    expect(report.testResults[0].assertionResults[0].status).toBe('passed');
    expect(report.testResults[0].assertionResults[1].status).toBe('failed');
  });
});

describe('validateReportConsistency', () => {
  it('returns no errors for a valid report', () => {
    const report = junitXmlToVitestJson(allPassedXml);
    const errors = validateReportConsistency(report);
    expect(errors).toEqual([]);
  });

  it('returns no errors for a report with failures', () => {
    const report = junitXmlToVitestJson(multiSuiteXml);
    const errors = validateReportConsistency(report);
    expect(errors).toEqual([]);
  });

  it('detects a failed suite with no failed assertions', () => {
    const report: VitestJsonReport = {
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      numTotalTestSuites: 1,
      numPassedTestSuites: 0,
      numFailedTestSuites: 1,
      numPendingTestSuites: 0,
      success: false,
      testResults: [
        {
          name: 'bad-suite',
          status: 'failed',
          assertionResults: [
            { title: 'a', fullName: 'bad-suite a', status: 'passed' },
          ],
        },
      ],
    };
    const errors = validateReportConsistency(report);
    expect(
      errors.some((e) =>
        e.includes('marked failed but has no failed assertions'),
      ),
    ).toBe(true);
  });

  it('detects a passed suite with failed assertions', () => {
    const report: VitestJsonReport = {
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
      numTotalTestSuites: 1,
      numPassedTestSuites: 1,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      success: false,
      testResults: [
        {
          name: 'bad-suite',
          status: 'passed',
          assertionResults: [
            { title: 'a', fullName: 'bad-suite a', status: 'failed' },
          ],
        },
      ],
    };
    const errors = validateReportConsistency(report);
    expect(errors.some((e) => e.includes('marked passed but has'))).toBe(true);
  });

  it('detects numTotalTests mismatch', () => {
    const report: VitestJsonReport = {
      numTotalTests: 10,
      numPassedTests: 1,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
      numTotalTestSuites: 1,
      numPassedTestSuites: 1,
      numFailedTestSuites: 0,
      numPendingTestSuites: 0,
      success: true,
      testResults: [
        {
          name: 's',
          status: 'passed',
          assertionResults: [{ title: 'a', fullName: 's a', status: 'passed' }],
        },
      ],
    };
    const errors = validateReportConsistency(report);
    expect(errors.some((e) => e.includes('numTotalTests'))).toBe(true);
  });
});

describe('serializeReport', () => {
  it('produces valid JSON with the expected top-level keys', () => {
    const report = junitXmlToVitestJson(allPassedXml);
    const json = serializeReport(report);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['numTotalTests']).toBe(3);
    expect(parsed['numPassedTests']).toBe(3);
    expect(parsed['success']).toBe(true);
    expect(Array.isArray(parsed['testResults'])).toBe(true);
  });
});

describe('nested Bun testsuite elements', () => {
  // Bun nests a `describe` suite inside the file-level suite and puts the
  // testcases only in the innermost one. Attributing a nested suite's cases to
  // its parent as well would double every count the evals aggregation reads.
  const nestedXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="bun test" tests="1" failures="1" skipped="0">',
    '  <testsuite name="save_memory.eval.ts" file="save_memory.eval.ts" tests="1" failures="1" skipped="0">',
    '    <testsuite name="save_memory" file="save_memory.eval.ts" tests="1" failures="1" skipped="0">',
    '      <testcase name="should be able to save to memory" classname="save_memory">',
    '        <failure type="AssertionError" />',
    '      </testcase>',
    '    </testsuite>',
    '  </testsuite>',
    '</testsuites>',
  ].join('\n');

  it('attributes a test case only to the suite that directly contains it', () => {
    const parsed = parseJUnitXml(nestedXml);
    const owning = parsed.suites.filter((s) => s.testCases.length > 0);
    expect(owning).toHaveLength(1);
    expect(owning[0].name).toBe('save_memory');
  });

  it('counts each nested test exactly once in the report', () => {
    const report = junitXmlToVitestJson(nestedXml);
    expect(report.numTotalTests).toBe(1);
    expect(report.numFailedTests).toBe(1);
    expect(report.numTotalTestSuites).toBe(1);
    expect(report.testResults).toHaveLength(1);
    expect(report.testResults[0].name).toBe('save_memory');
  });
});

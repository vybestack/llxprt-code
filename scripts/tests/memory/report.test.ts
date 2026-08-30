/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the growth report (scripts/memory/report.ts). The report
 * is a pure function over parsed samples, so tests feed synthetic samples and
 * assert on the rendered text.
 */

import { describe, expect, it } from 'bun:test';
import {
  REPORT_USAGE,
  ReportParseError,
  parseReportArgs,
  renderReport,
} from '../../memory/report.ts';
import { DEFAULT_TOP_TYPES, type Sample } from '../../memory/sample.ts';

const MB = 1024 * 1024;

function makeSample(
  tag: string,
  t: string,
  fields: {
    readonly heap: number;
    readonly extra: number;
    readonly rss: number;
    readonly objects: number;
    readonly protected?: number;
    readonly types: ReadonlyArray<readonly [string, number]>;
  },
): Sample {
  return {
    t,
    tag,
    pid: 4242,
    rss: fields.rss,
    heapSize: fields.heap,
    heapCapacity: fields.heap,
    extraMemorySize: fields.extra,
    objectCount: fields.objects,
    protectedObjectCount: fields.protected ?? 5,
    types: fields.types.map(([k, v]) => [k, v] as [string, number]),
  };
}

describe('renderReport', () => {
  it('renders a trend, growth classes, and a neutral note for >=2 samples', () => {
    const samples: Sample[] = [
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 100_000,
        types: [
          ['Object', 100],
          ['String', 50],
        ],
      }),
      makeSample('tick', '2026-08-14T10:01:00.000Z', {
        heap: 120 * MB,
        extra: 0,
        rss: 350 * MB,
        objects: 280_000,
        types: [
          ['Object', 300],
          ['String', 50],
        ],
      }),
    ];
    const out = renderReport(samples);
    expect(out).toContain('samples over');
    expect(out).toContain('Object');
    expect(out).toContain('MB/min');
    // No hardcoded owner attribution: the report must stay general-purpose.
    expect(out).not.toContain('HistoryService');
    expect(out).not.toMatch(/specific owner/i);
  });

  it('reports a short-session message for fewer than 2 samples', () => {
    const out = renderReport([
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 1,
        types: [],
      }),
    ]);
    expect(out).toContain('too short');
  });

  it('flags extraMemorySize dominance without treating counters as additive', () => {
    const samples: Sample[] = [
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 10 * MB,
        rss: 200 * MB,
        objects: 1,
        types: [],
      }),
      makeSample('tick', '2026-08-14T10:01:00.000Z', {
        heap: 50 * MB,
        extra: 200 * MB,
        rss: 400 * MB,
        objects: 1,
        types: [],
      }),
    ];
    const out = renderReport(samples);
    expect(out).toContain('extraMemorySize');
    expect(out).toContain('potentially');
    expect(out).toContain('not add');
  });

  it('reports protected-object growth without claiming an owner', () => {
    const samples: Sample[] = [
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 1,
        protected: 1_000,
        types: [],
      }),
      makeSample('tick', '2026-08-14T10:01:00.000Z', {
        heap: 60 * MB,
        extra: 0,
        rss: 220 * MB,
        objects: 2,
        protected: 2_500,
        types: [],
      }),
    ];
    const out = renderReport(samples);
    expect(out).toContain('protectedObjectCount 1,000 -> 2,500');
    expect(out).toContain('does not identify the retainer');
    expect(out).toContain('does not prove native ownership');
  });

  it('flags protected-object growth from a zero baseline', () => {
    const samples: Sample[] = [
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 1,
        protected: 0,
        types: [],
      }),
      makeSample('tick', '2026-08-14T10:01:00.000Z', {
        heap: 60 * MB,
        extra: 0,
        rss: 220 * MB,
        objects: 2,
        protected: 1,
        types: [],
      }),
    ];
    expect(renderReport(samples)).toContain('protectedObjectCount 0 -> 1');
  });

  it('does not flag protectedObjectCount growth below the doubling threshold', () => {
    const samples: Sample[] = [
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 1,
        protected: 1_000,
        types: [],
      }),
      makeSample('tick', '2026-08-14T10:01:00.000Z', {
        heap: 60 * MB,
        extra: 0,
        rss: 220 * MB,
        objects: 2,
        protected: 1_900,
        types: [],
      }),
    ];
    const out = renderReport(samples);
    expect(out).not.toContain('protectedObjectCount 1,000');
  });

  it('never sums heapSize with extraMemorySize', () => {
    const samples: Sample[] = [
      makeSample('startup', '2026-08-14T10:00:00.000Z', {
        heap: 50 * MB,
        extra: 25 * MB,
        rss: 200 * MB,
        objects: 10,
        types: [],
      }),
      makeSample('tick', '2026-08-14T10:05:00.000Z', {
        heap: 50 * MB,
        extra: 25 * MB,
        rss: 200 * MB,
        objects: 10,
        types: [],
      }),
    ];
    const out = renderReport(samples);
    // The report presents the counters separately and says so explicitly.
    expect(out).toContain('never summed');
  });
});

describe('parseReportArgs — strict CLI parsing', () => {
  it('accepts no arguments (default: latest run)', () => {
    expect(parseReportArgs([])).toEqual({ help: false, target: undefined });
  });

  it('accepts exactly one positional target', () => {
    expect(parseReportArgs(['some/dir'])).toEqual({
      help: false,
      target: 'some/dir',
    });
  });

  it('supports help flags', () => {
    expect(parseReportArgs(['--help']).help).toBe(true);
    expect(parseReportArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown options with the usage line', () => {
    expect(() => parseReportArgs(['--top'])).toThrow(ReportParseError);
    try {
      parseReportArgs(['--top']);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(ReportParseError);
      const message = (error as ReportParseError).message;
      expect(message).toContain('unknown option: --top');
      expect(message).toContain(REPORT_USAGE.split('\n')[0]);
    }
  });

  it('rejects flag-shaped targets', () => {
    expect(() => parseReportArgs(['-x'])).toThrow(ReportParseError);
  });

  it('rejects extra positional arguments', () => {
    expect(() => parseReportArgs(['a', 'b'])).toThrow(
      /unexpected extra argument/,
    );
  });
});

describe('renderReport — honest truncation handling (#3230)', () => {
  const T0 = '2026-08-14T10:00:00.000Z';
  const T1 = '2026-08-14T10:05:00.000Z';

  function fullHistogram(tag: string, t: string, base: number): Sample {
    // Exactly DEFAULT_TOP_TYPES entries → possibly truncated. Bound to the
    // exported constant so the fixture tracks any future cutoff change.
    const types: Array<[string, number]> = [];
    for (let i = 0; i < DEFAULT_TOP_TYPES; i++) {
      types.push([`Type${String(i).padStart(2, '0')}`, base + i * 10]);
    }
    return makeSample(tag, t, {
      heap: 50 * MB,
      extra: 0,
      rss: 200 * MB,
      objects: 100_000,
      types,
    });
  }

  it('does not report a type that appears only in the last sample as growth from zero', () => {
    // "NewType" enters the last sample's top-N but was NOT in the first
    // sample's histogram. Its baseline is unknown (truncation), so the report
    // must not present it as +N growth from zero.
    const first = fullHistogram('startup', T0, 100);
    const lastTypes = fullHistogram('tick', T1, 100).types.slice(
      0,
      DEFAULT_TOP_TYPES - 1,
    );
    lastTypes.push(['NewType', 5_000]);
    const last = makeSample('tick', T1, {
      heap: 120 * MB,
      extra: 0,
      rss: 300 * MB,
      objects: 200_000,
      types: lastTypes,
    });
    const out = renderReport([first, last]);
    expect(out).not.toContain('NewType');
    // And the report states why: absent types are inconclusive.
    expect(out).toContain('INCONCLUSIVE');
  });

  it('never claims the graph is flat when histograms are truncated', () => {
    // Identical truncated histograms: no comparable type grew, but growth in
    // unrecorded types cannot be ruled out — "flat" would overclaim.
    const out = renderReport([
      fullHistogram('startup', T0, 100),
      fullHistogram('tick', T1, 100),
    ]);
    expect(out).not.toMatch(/graph is flat/i);
    expect(out).toContain('no object type increased');
    expect(out).toContain('INCONCLUSIVE');
  });

  it('reports the measured no-increase fact without flatness claims even when complete', () => {
    // Complete (untruncated) histograms: the honest statement is the measured
    // fact itself — no comparable type increased — never "the object graph is
    // flat", which would claim total knowledge of the heap.
    const out = renderReport([
      makeSample('startup', T0, {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 100,
        types: [
          ['Object', 100],
          ['String', 50],
        ],
      }),
      makeSample('tick', T1, {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 100,
        types: [
          ['Object', 100],
          ['String', 50],
        ],
      }),
    ]);
    expect(out).toContain('no object type increased');
    expect(out).not.toMatch(/graph is flat/i);
    // Complete histograms carry no truncation caveat.
    expect(out).not.toContain('INCONCLUSIVE');
  });

  it('reports growth for types carried across both endpoint samples', () => {
    const out = renderReport([
      makeSample('startup', T0, {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 100,
        types: [['Object', 100]],
      }),
      makeSample('tick', T1, {
        heap: 90 * MB,
        extra: 0,
        rss: 300 * MB,
        objects: 300,
        types: [['Object', 280]],
      }),
    ]);
    expect(out).toContain('Object');
    // The delta table pads numbers; assert the padded +180 and current count.
    expect(out).toMatch(/\+\s*180/);
    expect(out).toContain('(now 280)');
  });

  it('compares truncated histograms only on carried types', () => {
    // First sample truncated (top DEFAULT_TOP_TYPES), last sample truncated
    // with different entries: only shared entries are comparable; a type
    // missing from the first histogram must not be reported as growth.
    const firstTypes: Array<[string, number]> = [];
    for (let i = 0; i < DEFAULT_TOP_TYPES; i++) {
      firstTypes.push([`Carry${i}`, 100]);
    }
    const lastTypes: Array<[string, number]> = firstTypes.map(
      ([type, count]) => [type, count + 40] as [string, number],
    );
    lastTypes[DEFAULT_TOP_TYPES - 1] = ['OnlyInLast', 9_999];
    const out = renderReport([
      makeSample('startup', T0, {
        heap: 50 * MB,
        extra: 0,
        rss: 200 * MB,
        objects: 100,
        types: firstTypes,
      }),
      makeSample('tick', T1, {
        heap: 90 * MB,
        extra: 0,
        rss: 300 * MB,
        objects: 400,
        types: lastTypes,
      }),
    ]);
    expect(out).toContain('Carry0');
    expect(out).not.toContain('OnlyInLast');
    // With growth present, the caveat is the closing footer line.
    expect(out).toMatch(/inconclusive, not zero/i);
  });
});

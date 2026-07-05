/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-008.3, REQ-008.4
 * @pseudocode lines 95-98
 */
import { describe, expect } from 'vitest';
import { it } from '@fast-check/vitest';
import * as fc from 'fast-check';
import type {
  GroundingSource,
  GroundingSegment,
  GroundingInfo,
  UrlAccessInfo,
} from './grounding.js';

describe('GroundingInfo shape', () => {
  it('constructs with sources array', () => {
    const info: GroundingInfo = {
      sources: [{ title: 'Google', url: 'https://google.com' }],
    };
    expect(info.sources).toHaveLength(1);
    expect(info.sources[0].url).toBe('https://google.com');
    expect(info.segments).toBeUndefined();
  });

  it('constructs with sources and segments', () => {
    const info: GroundingInfo = {
      sources: [
        { title: 'A', url: 'https://a.com', snippet: 'snippet A' },
        { url: 'https://b.com' },
        { title: 'C' },
      ],
      segments: [
        { startIndex: 0, endIndex: 10, text: 'hello', sourceIndices: [0, 1] },
        { text: 'world' },
      ],
    };
    expect(info.sources).toHaveLength(3);
    expect(info.segments).toHaveLength(2);
    expect(info.sources[0].snippet).toBe('snippet A');
    expect(info.segments?.[0]?.sourceIndices).toStrictEqual([0, 1]);
  });

  it('GroundingSource allows empty object (all optional fields)', () => {
    const src: GroundingSource = {};
    expect(src.title).toBeUndefined();
    expect(src.url).toBeUndefined();
    expect(src.snippet).toBeUndefined();
  });

  it('GroundingSegment allows empty object (all optional fields)', () => {
    const seg: GroundingSegment = {};
    expect(seg.startIndex).toBeUndefined();
    expect(seg.text).toBeUndefined();
  });
});

describe('UrlAccessInfo shape', () => {
  it('constructs with url and status', () => {
    const info: UrlAccessInfo = {
      url: 'https://example.com/page',
      status: '200',
    };
    expect(info.url).toBe('https://example.com/page');
    expect(info.status).toBe('200');
  });

  it('allows arbitrary status string', () => {
    const info: UrlAccessInfo = { url: 'https://x.com', status: 'BLOCKED' };
    expect(info.status).toBe('BLOCKED');
  });
});

// ============================================================================
// Property-based tests
// ============================================================================

describe('grounding property-based', () => {
  it.prop([
    fc.array(
      fc.record({
        title: fc.option(fc.string({ maxLength: 50 })),
        url: fc.option(fc.webUrl()),
        snippet: fc.option(fc.string({ maxLength: 100 })),
      }),
      { minLength: 0, maxLength: 10 },
    ),
  ])(
    'GroundingInfo preserves all source data through JSON round-trip',
    (sources) => {
      const cleanedSources: GroundingSource[] = sources.map((s) => {
        const out: GroundingSource = {};
        if (s.title !== null) out.title = s.title;
        if (s.url !== null) out.url = s.url;
        if (s.snippet !== null) out.snippet = s.snippet;
        return out;
      });
      const info: GroundingInfo = { sources: cleanedSources };
      const roundTripped: GroundingInfo = JSON.parse(JSON.stringify(info));
      return (
        roundTripped.sources.length === cleanedSources.length &&
        roundTripped.segments === undefined &&
        roundTripped.sources.every(
          (src, i) =>
            src.title === cleanedSources[i].title &&
            src.url === cleanedSources[i].url &&
            src.snippet === cleanedSources[i].snippet,
        )
      );
    },
  );

  it.prop([
    fc.record({
      url: fc.webUrl(),
      status: fc.string({ minLength: 1, maxLength: 20 }),
    }),
  ])(
    'UrlAccessInfo preserves url and status through JSON round-trip',
    (input) => {
      const info: UrlAccessInfo = { url: input.url, status: input.status };
      const roundTripped: UrlAccessInfo = JSON.parse(JSON.stringify(info));
      return (
        roundTripped.url === info.url && roundTripped.status === info.status
      );
    },
  );

  it.prop([
    fc.array(
      fc.record({
        startIndex: fc.option(fc.nat()),
        endIndex: fc.option(fc.nat()),
        text: fc.option(fc.string({ maxLength: 50 })),
        sourceIndices: fc.option(fc.array(fc.nat(), { maxLength: 5 })),
      }),
      { minLength: 0, maxLength: 8 },
    ),
  ])(
    'GroundingSegment array round-trips through JSON preserving all optional fields',
    (segments) => {
      const cleaned: GroundingSegment[] = segments.map((s) => {
        const out: GroundingSegment = {};
        if (s.startIndex !== null) out.startIndex = s.startIndex;
        if (s.endIndex !== null) out.endIndex = s.endIndex;
        if (s.text !== null) out.text = s.text;
        if (s.sourceIndices !== null) out.sourceIndices = s.sourceIndices;
        return out;
      });
      const roundTripped: GroundingSegment[] = JSON.parse(
        JSON.stringify(cleaned),
      );
      return JSON.stringify(roundTripped) === JSON.stringify(cleaned);
    },
  );

  it.prop([
    fc.record({
      sources: fc.array(
        fc.record({
          title: fc.option(fc.string({ maxLength: 30 })),
          url: fc.option(fc.webUrl()),
          snippet: fc.option(fc.string({ maxLength: 80 })),
        }),
        { minLength: 0, maxLength: 5 },
      ),
      segments: fc.array(
        fc.record({
          startIndex: fc.option(fc.nat()),
          endIndex: fc.option(fc.nat()),
          text: fc.option(fc.string({ maxLength: 50 })),
          sourceIndices: fc.option(fc.array(fc.nat(), { maxLength: 5 })),
        }),
        { minLength: 0, maxLength: 5 },
      ),
    }),
  ])(
    'GroundingInfo with sources AND segments round-trips through JSON preserving all fields',
    (input) => {
      const cleanedSources: GroundingSource[] = input.sources.map((s) => {
        const out: GroundingSource = {};
        if (s.title !== null) out.title = s.title;
        if (s.url !== null) out.url = s.url;
        if (s.snippet !== null) out.snippet = s.snippet;
        return out;
      });
      const cleanedSegments: GroundingSegment[] = input.segments.map((s) => {
        const out: GroundingSegment = {};
        if (s.startIndex !== null) out.startIndex = s.startIndex;
        if (s.endIndex !== null) out.endIndex = s.endIndex;
        if (s.text !== null) out.text = s.text;
        if (s.sourceIndices !== null) out.sourceIndices = s.sourceIndices;
        return out;
      });
      const info: GroundingInfo = {
        sources: cleanedSources,
        segments: cleanedSegments,
      };
      const roundTripped: GroundingInfo = JSON.parse(JSON.stringify(info));
      return JSON.stringify(roundTripped) === JSON.stringify(info);
    },
  );
});

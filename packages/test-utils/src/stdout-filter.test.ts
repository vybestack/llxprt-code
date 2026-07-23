/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { stripTelemetryFromStdout } from './stdout-filter.js';

describe('stripTelemetryFromStdout', () => {
  it('preserves pretty-printed CLI JSON and its whitespace', () => {
    const cliJson = [
      '{',
      '  "response": "$blue$",',
      '  "session_id": "session-1",',
      '  "stats": { "tools": { "totalCalls": 1 } }',
      '}',
      '',
    ].join('\r\n');

    expect(stripTelemetryFromStdout(cliJson)).toBe(cliJson);
  });

  it('preserves ordinary JSON that happens to contain telemetry-like keys', () => {
    const value = JSON.stringify(
      {
        body: 'user content',
        timestamp: 123,
        attributes: { theme: 'blue' },
      },
      null,
      2,
    );

    expect(stripTelemetryFromStdout(value)).toBe(value);
  });

  it('preserves ordinary JSON with only an LLxprt event name', () => {
    const value = JSON.stringify(
      { attributes: { 'event.name': 'llxprt_code.tool_call' } },
      null,
      2,
    );

    expect(stripTelemetryFromStdout(value)).toBe(value);
  });

  it('preserves a CLI response envelope even with telemetry-shaped fields', () => {
    const value = JSON.stringify(
      {
        response: '$blue$',
        attributes: { 'event.name': 'llxprt_code.tool_call' },
      },
      null,
      2,
    );

    expect(stripTelemetryFromStdout(value)).toBe(value);
  });

  it('preserves inspected objects without the LLxprt service identity', () => {
    const value = [
      '{',
      "  resource: { attributes: { 'service.name': 'user-content' } },",
      "  instrumentationScope: { name: 'user-content' }",
      '}',
    ].join('\n');

    expect(stripTelemetryFromStdout(value)).toBe(value);
  });

  it('removes JSON telemetry events identified by llxprt event name', () => {
    const telemetry = JSON.stringify(
      {
        timestamp: 123,
        body: 'Tool call: save_memory. Success: true. Duration: 5ms',
        attributes: {
          'event.name': 'llxprt_code.tool_call',
          function_args: '{"fact":"test {value}"}',
        },
      },
      null,
      2,
    );

    expect(stripTelemetryFromStdout(`${telemetry}\n$blue$\n`)).toBe('$blue$\n');
  });

  it('preserves tool-call-shaped JSON without a telemetry timestamp', () => {
    const value = JSON.stringify({
      body: 'Tool call: read_file. Success: true. Duration: 2ms',
      attributes: { function_args: '{}' },
    });

    expect(stripTelemetryFromStdout(value)).toBe(value);
  });

  it('removes fallback telemetry records with timestamp, body, and attributes', () => {
    const telemetry = JSON.stringify({
      timestamp: 123,
      body: 'Tool call: read_file. Success: true. Duration: 2ms',
      attributes: { function_args: '{}' },
    });

    expect(stripTelemetryFromStdout(`${telemetry}\nanswer`)).toBe('answer');
  });

  it('removes fallback tool telemetry with leading body whitespace', () => {
    const telemetry = JSON.stringify({
      timestamp: 123,
      body: '  Tool call: read_file. Success: true. Duration: 2ms',
      attributes: { function_args: '{}' },
    });

    expect(stripTelemetryFromStdout(`${telemetry}\nanswer`)).toBe('answer');
  });

  it('removes Node-inspected OpenTelemetry log exporter output', () => {
    const inspected = [
      '{',
      "  resource: { attributes: { 'service.name': 'llxprt-code' } },",
      "  instrumentationScope: { name: 'llxprt-code' },",
      '  timestamp: 123,',
      "  body: 'Tool call: save_memory with { braces }',",
      "  attributes: { 'event.name': 'llxprt_code.tool_call' }",
      '}',
      '{',
      '  "response": "$blue$"',
      '}',
    ].join('\n');

    expect(JSON.parse(stripTelemetryFromStdout(inspected))).toEqual({
      response: '$blue$',
    });
  });

  it('removes differently indented Node-inspected telemetry output', () => {
    const inspected = [
      '{',
      "\tresource: { attributes: { 'service.name': 'llxprt-code' } },",
      "\tinstrumentationScope: { name: 'llxprt-code' },",
      "\tbody: 'Tool call: save_memory'",
      '}',
      'done',
    ].join('\n');

    expect(stripTelemetryFromStdout(inspected)).toBe('done');
  });

  it('removes Node-inspected OpenTelemetry metric exporter output', () => {
    const inspected = [
      '{',
      "  descriptor: { name: 'llxprt.requests' },",
      '  dataPointType: 3,',
      '  dataPoints: []',
      '}',
      'done',
    ].join('\n');

    expect(stripTelemetryFromStdout(inspected)).toBe('done');
  });

  it('preserves blank lines that are not part of a removed object', () => {
    const input = 'first\n\nsecond\n';

    expect(stripTelemetryFromStdout(input)).toBe(input);
  });

  it('preserves malformed and inline JSON-like text', () => {
    const input =
      'prefix {"attributes":{"event.name":"llxprt_code.x"}} suffix\n{ broken';

    expect(stripTelemetryFromStdout(input)).toBe(input);
  });

  it('continues filtering after malformed object-like output', () => {
    const input = [
      '{ malformed user output',
      '{',
      "  resource: { attributes: { 'service.name': 'llxprt-code' } },",
      "  instrumentationScope: { name: 'llxprt-code' },",
      "  body: 'Tool call: save_memory'",
      '}',
      '{',
      '  "response": "$blue$"',
      '}',
    ].join('\n');

    expect(stripTelemetryFromStdout(input)).toBe(
      ['{ malformed user output', '{', '  "response": "$blue$"', '}'].join(
        '\n',
      ),
    );
  });
});

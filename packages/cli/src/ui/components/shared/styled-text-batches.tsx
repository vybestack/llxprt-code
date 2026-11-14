/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type React from 'react';
import { Text } from 'ink';
import chalk, { foregroundColorNames } from 'chalk';
import { Colors } from '../../colors.js';

export interface StyledTextSegment {
  text: string;
  props: Record<string, unknown>;
}

function colorText(text: string, color: unknown): string {
  if (typeof color !== 'string') return text;
  const named = foregroundColorNames.find((name) => name === color);
  if (named !== undefined) return chalk[named](text);
  if (color.startsWith('#')) return chalk.hex(color)(text);
  const rgb = /^rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)$/.exec(color);
  if (rgb !== null)
    return chalk.rgb(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]))(text);
  const indexed = /^ansi256\(\s?(\d+)\s?\)$/.exec(color);
  return indexed === null ? text : chalk.ansi256(Number(indexed[1]))(text);
}

/** Layout is already complete; keep terminal rows out of the Yoga tree. */
export function styledTextBatches(
  lines: ReadonlyArray<readonly StyledTextSegment[]>,
): React.ReactNode[] | undefined {
  if (
    lines.some((line) =>
      line.some((segment) =>
        Object.keys(segment.props).some(
          (key) => key !== 'color' && key !== 'wrap',
        ),
      ),
    )
  )
    return undefined;
  const batches: React.ReactNode[] = [];
  for (let start = 0; start < lines.length; start += 128) {
    const text = lines
      .slice(start, start + 128)
      .map((line) =>
        line.length === 0
          ? ' '
          : line
              .map((segment) =>
                colorText(
                  segment.text,
                  'color' in segment.props
                    ? segment.props.color
                    : Colors.Foreground,
                ),
              )
              .join(''),
      )
      .join('\n');
    batches.push(
      <Text key={start} color={Colors.Foreground} wrap="truncate">
        {text}
      </Text>,
    );
  }
  return batches;
}

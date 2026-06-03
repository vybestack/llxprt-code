/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import React, { Fragment, useEffect, useId } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { getCachedStringWidth, toCodePoints } from '../../utils/textUtils.js';
import { useOverflowActions } from '../../contexts/OverflowContext.js';
import { debugLogger } from '@vybestack/llxprt-code-core';

let enableDebugLog = false;

/**
 * Minimum height for the MaxSizedBox component.
 * This ensures there is room for at least one line of content as well as the
 * message that content was truncated.
 */
export const MINIMUM_MAX_HEIGHT = 2;

export function setMaxSizedBoxDebugging(value: boolean) {
  enableDebugLog = value;
}

function debugReportError(message: string, element: React.ReactNode) {
  if (!enableDebugLog) return;

  if (!React.isValidElement(element)) {
    debugLogger.error(
      message,
      `Invalid element: '${String(element)}' typeof=${typeof element}`,
    );
    return;
  }

  let sourceMessage = '<Unknown file>';
  try {
    const elementWithSource = element as {
      _source?: { fileName?: string; lineNumber?: number };
    };
    const fileName = elementWithSource._source?.fileName;
    const lineNumber = elementWithSource._source?.lineNumber;
    sourceMessage = fileName ? `${fileName}:${lineNumber}` : '<Unknown file>';
  } catch (error) {
    debugLogger.error('Error while trying to get file name:', error);
  }

  debugLogger.error(
    message,
    `${String(element.type)}. Source: ${sourceMessage}`,
  );
}

// Define a type for styled text segments
interface StyledText {
  text: string;
  props: Record<string, unknown>;
}

/**
 * Single row of content within the MaxSizedBox.
 *
 * A row can contain segments that are not wrapped, followed by segments that
 * are. This is a minimal implementation that only supports the functionality
 * needed today.
 */
interface Row {
  noWrapSegments: StyledText[];
  segments: StyledText[];
}

function visitChildrenAsRows(
  children: React.ReactNode,
  targetMaxWidth: number,
  laidOutStyledText: StyledText[][],
) {
  function visitRow(element: React.ReactNode) {
    if (!React.isValidElement<{ children?: React.ReactNode }>(element)) {
      return;
    }

    if (element.type === Fragment) {
      React.Children.forEach(element.props.children, visitRow);
      return;
    }

    if (element.type === Box) {
      layoutInkElementAsStyledText(element, targetMaxWidth, laidOutStyledText);
      return;
    }

    debugReportError('MaxSizedBox children must be <Box> elements', element);
  }

  React.Children.forEach(children, visitRow);
}

function validateBoxRowDebug(element: React.ReactElement) {
  if (!enableDebugLog) return;
  const boxProps = element.props as {
    children?: React.ReactNode;
    readonly flexDirection?:
      | 'row'
      | 'column'
      | 'row-reverse'
      | 'column-reverse';
  };
  let maxExpectedProps = 4;
  if (boxProps.children !== undefined) {
    maxExpectedProps += 1;
  }
  if (
    boxProps.flexDirection !== undefined &&
    boxProps.flexDirection !== 'row'
  ) {
    debugReportError(
      'MaxSizedBox children must have flexDirection="row".',
      element,
    );
  }
  if (Object.keys(boxProps).length > maxExpectedProps) {
    debugReportError(
      `Boxes inside MaxSizedBox must not have additional props. ${Object.keys(
        boxProps,
      ).join(', ')}`,
      element,
    );
  }
}

/**
 * Flattens the child elements of MaxSizedBox into an array of `Row` objects.
 *
 * This function expects a specific child structure to function correctly:
 * 1. The top-level child of `MaxSizedBox` should be a single `<Box>`. This
 *    outer box is primarily for structure and is not directly rendered.
 * 2. Inside the outer `<Box>`, there should be one or more children. Each of
 *    these children must be a `<Box>` that represents a row.
 * 3. Inside each "row" `<Box>`, the children must be `<Text>` components.
 *
 * The structure should look like this:
 * <MaxSizedBox>
 *   <Box> // Row 1
 *     <Text>...</Text>
 *     <Text>...</Text>
 *   </Box>
 *   <Box> // Row 2
 *     <Text>...</Text>
 *   </Box>
 * </MaxSizedBox>
 *
 * It is an error for a <Text> child without wrapping to appear after a
 * <Text> child with wrapping within the same row Box.
 *
 * @param element The React node to flatten.
 * @returns An array of `Row` objects.
 */
function visitBoxRow(element: React.ReactNode): Row {
  if (
    !React.isValidElement<{ children?: React.ReactNode }>(element) ||
    element.type !== Box
  ) {
    debugReportError(
      `All children of MaxSizedBox must be <Box> elements`,
      element,
    );
    return {
      noWrapSegments: [{ text: '<ERROR>', props: {} }],
      segments: [],
    };
  }

  validateBoxRowDebug(element);

  const row: Row = {
    noWrapSegments: [],
    segments: [],
  };

  let hasSeenWrapped = false;

  function visitRowChild(
    element: React.ReactNode,
    parentProps: Record<string, unknown> | undefined,
  ) {
    if (element === null) {
      return;
    }
    if (typeof element === 'string' || typeof element === 'number') {
      const text = String(element);
      if (!text) {
        return;
      }

      const segment: StyledText = { text, props: parentProps ?? {} };

      if (parentProps === undefined || parentProps.wrap === 'wrap') {
        hasSeenWrapped = true;
        row.segments.push(segment);
      } else if (!hasSeenWrapped) {
        row.noWrapSegments.push(segment);
      } else {
        row.segments.push(segment);
        debugReportError(
          'Text elements without wrapping cannot appear after elements with wrapping in the same row.',
          element,
        );
      }
      return;
    }

    if (!React.isValidElement<{ children?: React.ReactNode }>(element)) {
      debugReportError('Invalid element.', element);
      return;
    }

    if (element.type === Fragment) {
      React.Children.forEach(element.props.children, (child) =>
        visitRowChild(child, parentProps),
      );
      return;
    }

    if (element.type !== Text) {
      debugReportError(
        'Children of a row Box must be <Text> elements.',
        element,
      );
      return;
    }

    const { children, ...currentProps } = element.props;
    const mergedProps =
      parentProps === undefined
        ? currentProps
        : { ...parentProps, ...currentProps };
    React.Children.forEach(children, (child) =>
      visitRowChild(child, mergedProps),
    );
  }

  React.Children.forEach(element.props.children, (child) =>
    visitRowChild(child, undefined),
  );

  return row;
}

function layoutNonWrappingOnly(
  nonWrappingContent: StyledText[],
  output: StyledText[][],
) {
  const lines: StyledText[][] = [];
  let currentLine: StyledText[] = [];
  nonWrappingContent.forEach((segment) => {
    const textLines = segment.text.split('\n');
    textLines.forEach((text, index) => {
      if (index > 0) {
        lines.push(currentLine);
        currentLine = [];
      }
      if (text) {
        currentLine.push({ text, props: segment.props });
      }
    });
  });
  if (
    currentLine.length > 0 ||
    (nonWrappingContent.length > 0 &&
      nonWrappingContent[nonWrappingContent.length - 1].text.endsWith('\n'))
  ) {
    lines.push(currentLine);
  }
  for (const line of lines) {
    output.push(line);
  }
}

function appendTruncatedText(
  text: string,
  textWidth: number,
  maxWidth: number,
  props: Record<string, unknown>,
  currentLine: StyledText[],
  currentLineWidth: number,
) {
  const maxContentWidth = Math.max(0, maxWidth - getCachedStringWidth('…'));

  if (textWidth <= maxContentWidth && currentLineWidth === 0) {
    currentLine.push({ text, props });
  } else {
    const codePoints = toCodePoints(text);
    let truncatedWidth = currentLineWidth;
    let sliceEndIndex = 0;

    for (const char of codePoints) {
      const charWidth = getCachedStringWidth(char);
      if (truncatedWidth + charWidth > maxContentWidth) {
        break;
      }
      truncatedWidth += charWidth;
      sliceEndIndex++;
    }

    const slice = codePoints.slice(0, sliceEndIndex).join('');
    if (slice) {
      currentLine.push({ text: slice, props });
    }
    currentLine.push({ text: '…', props: {} });
  }
}

function layoutTruncatedNonWrapping(
  maxWidth: number,
  nonWrappingContent: StyledText[],
  output: StyledText[][],
) {
  const lines: StyledText[][] = [];
  let currentLine: StyledText[] = [];
  let currentLineWidth = 0;

  for (const segment of nonWrappingContent) {
    const textLines = segment.text.split('\n');
    textLines.forEach((text, index) => {
      if (index > 0) {
        lines.push(currentLine);
        currentLine = [];
        currentLineWidth = 0;
      }

      if (text) {
        const textWidth = getCachedStringWidth(text);
        if (index > 0 && textWidth > 0) {
          currentLine.push({ text: '…', props: {} });
          currentLineWidth = getCachedStringWidth('…');
        } else {
          appendTruncatedText(
            text,
            textWidth,
            maxWidth,
            segment.props,
            currentLine,
            currentLineWidth,
          );
          currentLineWidth =
            currentLine.length > 0
              ? currentLine.reduce(
                  (sum, s) => sum + getCachedStringWidth(s.text),
                  0,
                )
              : 0;
        }
      }
    });
  }

  if (
    currentLine.length > 0 ||
    (nonWrappingContent.length > 0 &&
      nonWrappingContent[nonWrappingContent.length - 1].text.endsWith('\n'))
  ) {
    lines.push(currentLine);
  }

  if (lines.length === 0) {
    lines.push([{ text: '…', props: {} }]);
  }

  for (const line of lines) {
    output.push(line);
  }
}

function splitOverlongWord(
  word: string,
  segmentProps: Record<string, unknown>,
  availableWidth: number,
  wrappingWidth: number,
  onAdd: (text: string, props: Record<string, unknown>) => void,
  onFlush: () => void,
): number {
  const wordAsCodePoints = toCodePoints(word);
  let remaining = wordAsCodePoints;
  let width = wrappingWidth;
  while (remaining.length > 0) {
    let splitIndex = 0;
    let splitWidth = 0;
    for (const char of remaining) {
      const charWidth = getCachedStringWidth(char);
      if (width + splitWidth + charWidth > availableWidth) {
        break;
      }
      splitWidth += charWidth;
      splitIndex++;
    }

    if (splitIndex > 0) {
      const part = remaining.slice(0, splitIndex).join('');
      onAdd(part, segmentProps);
      width += getCachedStringWidth(part);
      remaining = remaining.slice(splitIndex);
    }

    if (remaining.length > 0) {
      onFlush();
      width = 0;
    }
  }
  return width;
}

function layoutWithWrapping(
  nonWrappingContent: StyledText[],
  noWrappingWidth: number,
  availableWidth: number,
  row: Row,
  output: StyledText[][],
) {
  const lines: StyledText[][] = [];
  let wrappingPart: StyledText[] = [];
  let wrappingPartWidth = 0;

  function addWrappingPartToLines() {
    if (lines.length === 0) {
      lines.push([...nonWrappingContent, ...wrappingPart]);
    } else if (noWrappingWidth > 0) {
      lines.push([
        ...[{ text: ' '.repeat(noWrappingWidth), props: {} }],
        ...wrappingPart,
      ]);
    } else {
      lines.push(wrappingPart);
    }
    wrappingPart = [];
    wrappingPartWidth = 0;
  }

  function addToWrappingPart(text: string, props: Record<string, unknown>) {
    if (
      wrappingPart.length > 0 &&
      wrappingPart[wrappingPart.length - 1].props === props
    ) {
      wrappingPart[wrappingPart.length - 1].text += text;
    } else {
      wrappingPart.push({ text, props });
    }
  }

  row.segments.forEach((segment) => {
    const linesFromSegment = segment.text.split('\n');

    linesFromSegment.forEach((lineText, lineIndex) => {
      if (lineIndex > 0) {
        addWrappingPartToLines();
      }

      const words = lineText.split(/(\s+)/);

      words.forEach((word) => {
        if (!word) return;
        const wordWidth = getCachedStringWidth(word);

        if (
          wrappingPartWidth + wordWidth > availableWidth &&
          wrappingPartWidth > 0
        ) {
          addWrappingPartToLines();
          if (/^\s+$/.test(word)) {
            return;
          }
        }

        if (wordWidth > availableWidth) {
          wrappingPartWidth = splitOverlongWord(
            word,
            segment.props,
            availableWidth,
            wrappingPartWidth,
            addToWrappingPart,
            addWrappingPartToLines,
          );
        } else {
          addToWrappingPart(word, segment.props);
          wrappingPartWidth += wordWidth;
        }
      });
    });
    if (segment.text.endsWith('\n')) {
      addWrappingPartToLines();
    }
  });

  if (wrappingPart.length > 0) {
    addWrappingPartToLines();
  }
  for (const line of lines) {
    output.push(line);
  }
}

function layoutInkElementAsStyledText(
  element: React.ReactElement,
  maxWidth: number,
  output: StyledText[][],
) {
  const row = visitBoxRow(element);
  if (row.segments.length === 0 && row.noWrapSegments.length === 0) {
    output.push([]);
    return;
  }

  const nonWrappingContent: StyledText[] = [];
  let noWrappingWidth = 0;

  row.noWrapSegments.forEach((segment) => {
    nonWrappingContent.push(segment);
    noWrappingWidth += getCachedStringWidth(segment.text);
  });

  if (row.segments.length === 0) {
    layoutNonWrappingOnly(nonWrappingContent, output);
    return;
  }

  const availableWidth = maxWidth - noWrappingWidth;

  if (availableWidth < 1) {
    layoutTruncatedNonWrapping(maxWidth, nonWrappingContent, output);
    return;
  }

  layoutWithWrapping(
    nonWrappingContent,
    noWrappingWidth,
    availableWidth,
    row,
    output,
  );
}

interface MaxSizedBoxProps {
  children?: React.ReactNode;
  maxWidth?: number;
  maxHeight: number | undefined;
  overflowDirection?: 'top' | 'bottom';
  additionalHiddenLinesCount?: number;
}

/**
 * A React component that constrains the size of its children and provides
 * content-aware truncation when the content exceeds the specified `maxHeight`.
 *
 * `MaxSizedBox` requires a specific structure for its children to correctly
 * measure and render the content:
 *
 * 1.  **Direct children must be `<Box>` elements.** Each `<Box>` represents a
 *     single row of content.
 * 2.  **Row `<Box>` elements must contain only `<Text>` elements.** These
 *     `<Text>` elements can be nested and there are no restrictions to Text
 *     element styling other than that non-wrapping text elements must be
 *     before wrapping text elements.
 *
 * **Constraints:**
 * - **Box Properties:** Custom properties on the child `<Box>` elements are
 *   ignored. In debug mode, runtime checks will report errors for any
 *   unsupported properties.
 * - **Text Wrapping:** Within a single row, `<Text>` elements with no wrapping
 *   (e.g., headers, labels) must appear before any `<Text>` elements that wrap.
 * - **Element Types:** Runtime checks will warn if unsupported element types
 *   are used as children.
 *
 * @example
 * <MaxSizedBox maxWidth={80} maxHeight={10}>
 *   <Box>
 *     <Text>This is the first line.</Text>
 *   </Box>
 *   <Box>
 *     <Text color="cyan" wrap="truncate">Non-wrapping Header: </Text>
 *     <Text>This is the rest of the line which will wrap if it's too long.</Text>
 *   </Box>
 *   <Box>
 *     <Text>
 *       Line 3 with <Text color="yellow">nested styled text</Text> inside of it.
 *     </Text>
 *   </Box>
 * </MaxSizedBox>
 */
export const MaxSizedBox: React.FC<MaxSizedBoxProps> = ({
  children,
  maxWidth,
  maxHeight,
  overflowDirection = 'top',
  additionalHiddenLinesCount = 0,
}) => {
  const id = useId();
  const { addOverflowingId, removeOverflowingId } = useOverflowActions() ?? {};

  const laidOutStyledText: StyledText[][] = [];
  const targetMaxHeight = Math.max(
    Math.round(maxHeight ?? Number.MAX_SAFE_INTEGER),
    MINIMUM_MAX_HEIGHT,
  );

  if (maxWidth === undefined) {
    throw new Error('maxWidth must be defined when maxHeight is set.');
  }
  visitChildrenAsRows(children, maxWidth, laidOutStyledText);

  const contentWillOverflow =
    laidOutStyledText.length > targetMaxHeight ||
    additionalHiddenLinesCount > 0;
  const visibleContentHeight = contentWillOverflow
    ? targetMaxHeight - 1
    : targetMaxHeight;

  const hiddenLinesCount = Math.max(
    0,
    laidOutStyledText.length - visibleContentHeight,
  );
  const totalHiddenLines = hiddenLinesCount + additionalHiddenLinesCount;

  useEffect(() => {
    if (totalHiddenLines > 0) {
      addOverflowingId?.(id);
    } else {
      removeOverflowingId?.(id);
    }

    return () => {
      removeOverflowingId?.(id);
    };
  }, [id, totalHiddenLines, addOverflowingId, removeOverflowingId]);

  const visibleStyledText =
    hiddenLinesCount > 0
      ? // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
        overflowDirection === 'top'
        ? laidOutStyledText.slice(hiddenLinesCount, laidOutStyledText.length)
        : laidOutStyledText.slice(0, visibleContentHeight)
      : laidOutStyledText;

  const visibleLines = visibleStyledText.map((line, index) => (
    <Box key={index}>
      {line.length > 0 ? (
        line.map((segment, segIndex) => (
          <Text key={segIndex} color={Colors.Foreground} {...segment.props}>
            {segment.text}
          </Text>
        ))
      ) : (
        <Text color={Colors.Foreground}> </Text>
      )}
    </Box>
  ));

  return (
    <Box flexDirection="column" width={maxWidth} flexShrink={0}>
      {totalHiddenLines > 0 && overflowDirection === 'top' && (
        <Text color={Colors.Gray} wrap="truncate">
          ... first {totalHiddenLines} line{totalHiddenLines === 1 ? '' : 's'}{' '}
          hidden ...
        </Text>
      )}
      {visibleLines}
      {totalHiddenLines > 0 && overflowDirection === 'bottom' && (
        <Text color={Colors.Gray} wrap="truncate">
          ... last {totalHiddenLines} line{totalHiddenLines === 1 ? '' : 's'}{' '}
          hidden ...
        </Text>
      )}
    </Box>
  );
};

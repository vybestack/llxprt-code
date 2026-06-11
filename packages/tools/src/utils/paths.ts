/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';

type TruncateMode = 'start' | 'end' | 'center';

function simpleTruncate(filePath: string, maxLen: number): string {
  const keepLen = Math.floor((maxLen - 3) / 2);
  if (keepLen <= 0) {
    return filePath.substring(0, maxLen - 3) + '...';
  }
  const start = filePath.substring(0, keepLen);
  const end = filePath.substring(filePath.length - keepLen);
  return `${start}...${end}`;
}

function truncateComponent(
  component: string,
  targetLength: number,
  mode: TruncateMode,
): string {
  if (component.length <= targetLength) return component;
  if (targetLength <= 0) return '';
  if (targetLength <= 3) {
    if (mode === 'end') return component.slice(-targetLength);
    return component.slice(0, targetLength);
  }
  if (mode === 'start') {
    return `${component.slice(0, targetLength - 3)}...`;
  }
  if (mode === 'end') {
    return `...${component.slice(component.length - (targetLength - 3))}`;
  }
  const front = Math.ceil((targetLength - 3) / 2);
  const back = targetLength - 3 - front;
  return `${component.slice(0, front)}...${component.slice(
    component.length - back,
  )}`;
}

function trailingFallback(
  root: string,
  separator: string,
  lastSegment: string,
  maxLen: number,
  filePath: string,
): string {
  const ellipsisTail = `...${separator}${lastSegment}`;
  if (ellipsisTail.length <= maxLen) return ellipsisTail;

  if (root) {
    const rootEllipsisTail = `${root}...${separator}${lastSegment}`;
    if (rootEllipsisTail.length <= maxLen) return rootEllipsisTail;
  }

  if (root && `${root}${lastSegment}`.length <= maxLen) {
    return `${root}${lastSegment}`;
  }

  if (lastSegment.length <= maxLen) return lastSegment;

  return simpleTruncate(filePath, maxLen);
}

function computeEndPartSegments(
  segments: string[],
  startComponent: string,
  separator: string,
  maxLen: number,
): string[] {
  const lastSegment = segments[segments.length - 1];
  const endPartSegments = [lastSegment];
  let endPartLength = lastSegment.length;

  for (let i = segments.length - 2; i > 0; i--) {
    const segment = segments[i];
    const newLength =
      startComponent.length +
      separator.length +
      3 +
      separator.length +
      endPartLength +
      separator.length +
      segment.length;

    if (newLength <= maxLen) {
      endPartSegments.unshift(segment);
      endPartLength += separator.length + segment.length;
    } else {
      break;
    }
  }
  return endPartSegments;
}

function computeBudgets(
  components: string[],
  minLengths: number[],
  availableForComponents: number,
): number[] | null {
  const budgets = components.map((component) => component.length);
  let currentTotal = budgets.reduce((sum, len) => sum + len, 0);

  while (currentTotal > availableForComponents) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < budgets.length; i++) {
      if (budgets[i] <= minLengths[i]) continue;
      const isLast = i === budgets.length - 1;
      const score = (isLast ? 0 : 1_000_000) + budgets[i];
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) return null;
    budgets[bestIndex]--;
    currentTotal--;
  }
  return budgets;
}

export function shortenPath(filePath: string, maxLen: number = 35): string {
  if (filePath.length <= maxLen) {
    return filePath;
  }

  const parsedPath = path.parse(filePath);
  const root = parsedPath.root;
  const separator = path.sep;

  const relativePath = filePath.substring(root.length);
  const segments = relativePath.split(separator).filter((s) => s !== '');

  if (segments.length <= 1) {
    return simpleTruncate(filePath, maxLen);
  }

  const firstDir = segments[0];
  const lastSegment = segments[segments.length - 1];
  const startComponent = root + firstDir;

  const endPartSegments = computeEndPartSegments(
    segments,
    startComponent,
    separator,
    maxLen,
  );

  const components = [firstDir, ...endPartSegments];
  const componentModes: TruncateMode[] = components.map((_, index) => {
    if (index === 0) return 'start';
    if (index === components.length - 1) return 'end';
    return 'center';
  });

  const separatorsCount = endPartSegments.length + 1;
  const fixedLen = root.length + separatorsCount * separator.length + 3;
  const availableForComponents = maxLen - fixedLen;

  if (availableForComponents <= 0) {
    return trailingFallback(root, separator, lastSegment, maxLen, filePath);
  }

  const minLengths = components.map((component, index) => {
    if (index === 0) return Math.min(component.length, 1);
    if (index === components.length - 1) return component.length;
    return Math.min(component.length, 1);
  });

  const minTotal = minLengths.reduce((sum, len) => sum + len, 0);
  if (availableForComponents < minTotal) {
    return trailingFallback(root, separator, lastSegment, maxLen, filePath);
  }

  const budgets = computeBudgets(
    components,
    minLengths,
    availableForComponents,
  );
  if (budgets === null) {
    return trailingFallback(root, separator, lastSegment, maxLen, filePath);
  }

  const truncatedComponents = components.map((component, index) =>
    truncateComponent(component, budgets[index], componentModes[index]),
  );

  const truncatedFirst = truncatedComponents[0];
  const truncatedEnd = truncatedComponents.slice(1).join(separator);
  const result = `${root}${truncatedFirst}${separator}...${separator}${truncatedEnd}`;

  if (result.length > maxLen) {
    return trailingFallback(root, separator, lastSegment, maxLen, filePath);
  }

  return result;
}

export function makeRelative(
  targetPath: string,
  rootDirectory: string,
): string {
  const resolvedTargetPath = path.resolve(targetPath);
  const resolvedRootDirectory = path.resolve(rootDirectory);
  const relativePath = path.relative(resolvedRootDirectory, resolvedTargetPath);
  return relativePath || '.';
}

const FILE_ENTRIES = [
  'Abacadbras.tsx',
  'README.md',
  'Zapper.ts',
  'packages/',
  'packages/src',
  'packages/src/Main.ts',
  'packages/src/Other.ts',
  'package.json',
] as const;

const MAX_SUGGESTIONS = 5;

export function getSuggestions(
  query: string,
  limit: number = MAX_SUGGESTIONS,
): string[] {
  const normalized = query.trim().toLowerCase();

  const matches = FILE_ENTRIES.filter((entry) => {
    const segments = entry.split('/').filter(Boolean);
    if (normalized.length === 0) {
      return true;
    }
    return segments.some((segment) =>
      segment.toLowerCase().startsWith(normalized),
    );
  });

  const sorted = [...matches].sort((a, b) => {
    const aSegments = a.split('/').filter(Boolean);
    const bSegments = b.split('/').filter(Boolean);

    const aIsFile = isFile(a);
    const bIsFile = isFile(b);

    if (aSegments.length !== bSegments.length) {
      return aSegments.length - bSegments.length;
    }

    if (aIsFile !== bIsFile) {
      return aIsFile ? -1 : 1;
    }

    if (a.length !== b.length) {
      return a.length - b.length;
    }

    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  return sorted.slice(0, limit);
}

export function extractMentionQuery(
  input: string,
  cursorOffset: number,
): string | null {
  const safeOffset = Math.min(Math.max(cursorOffset, 0), input.length);
  const upToCursor = input.slice(0, safeOffset);
  const atIndex = upToCursor.lastIndexOf('@');

  if (atIndex === -1) {
    return null;
  }

  if (atIndex > 0 && /\S/.test(upToCursor[atIndex - 1] ?? '')) {
    return null;
  }

  const tail = upToCursor.slice(atIndex + 1);
  const query = tail.split(/\s|\n/)[0] ?? '';
  return query;
}

export function findMentionRange(
  input: string,
  cursorOffset: number,
): { start: number; end: number } | null {
  const safeOffset = Math.min(Math.max(cursorOffset, 0), input.length);
  const upToCursor = input.slice(0, safeOffset);
  const atIndex = upToCursor.lastIndexOf('@');

  if (atIndex === -1) {
    return null;
  }

  if (atIndex > 0 && /\S/.test(upToCursor[atIndex - 1] ?? '')) {
    return null;
  }

  let end = safeOffset;
  while (end < input.length) {
    const char = input[end] ?? '';
    if (char === '\n' || char.trim() === '') {
      break;
    }
    end += 1;
  }

  return { start: atIndex, end };
}

export const SUGGESTION_SOURCE = FILE_ENTRIES;
export const MAX_SUGGESTION_COUNT = MAX_SUGGESTIONS;

function isFile(entry: string): boolean {
  if (entry.endsWith('/')) {
    return false;
  }
  return entry.includes('.');
}

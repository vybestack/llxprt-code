/**
 * Provides deterministic JSON stringification for pattern matching in policy rules.
 * Ensures consistent ordering of object keys and handling of special values.
 */

type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Deterministically stringifies a value for use in pattern matching.
 * - Object keys are sorted alphabetically
 * - Arrays maintain their order
 * - undefined values are omitted
 * - Functions and symbols are converted to null
 * - Circular references throw an error
 *
 * @param value - The value to stringify
 * @param space - Optional spacing for readability (default: none)
 * @returns Deterministic JSON string
 */
export function stableStringify(
  value: unknown,
  space?: string | number,
): string {
  const seen = new WeakSet<object>();

  function stringify(
    val: unknown,
    indent: string,
    currentDepth: number,
  ): string {
    // Handle primitives
    if (val === null) return 'null';
    if (val === undefined) return 'null';
    if (typeof val === 'boolean') return String(val);
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return 'null';
      return String(val);
    }
    if (typeof val === 'string') {
      return JSON.stringify(val);
    }

    // Handle functions and symbols
    if (typeof val === 'function' || typeof val === 'symbol') {
      return 'null';
    }

    // Handle objects and arrays
    if (typeof val === 'object') {
      // Circular reference check
      if (seen.has(val)) {
        throw new TypeError('Converting circular structure to JSON');
      }
      seen.add(val);

      try {
        // Handle arrays
        if (Array.isArray(val)) {
          const items: string[] = [];
          const nextIndent = space ? indent + getIndentString(space) : '';
          const separator = space ? '\n' : '';

          for (let i = 0; i < val.length; i++) {
            const item = stringify(val[i], nextIndent, currentDepth + 1);
            items.push(space ? `${nextIndent}${item}` : item);
          }

          if (items.length === 0) {
            return '[]';
          }

          return space
            ? `[${separator}${items.join(`,${separator}`)}${separator}${indent}]`
            : `[${items.join(',')}]`;
        }

        // Handle objects
        const keys = Object.keys(val).sort();
        const pairs: string[] = [];
        const nextIndent = space ? indent + getIndentString(space) : '';
        const separator = space ? '\n' : '';

        for (const key of keys) {
          const value = (val as Record<string, unknown>)[key];
          if (value !== undefined) {
            const stringifiedKey = JSON.stringify(key);
            const stringifiedValue = stringify(
              value,
              nextIndent,
              currentDepth + 1,
            );
            const pair = space
              ? `${nextIndent}${stringifiedKey}: ${stringifiedValue}`
              : `${stringifiedKey}:${stringifiedValue}`;
            pairs.push(pair);
          }
        }

        if (pairs.length === 0) {
          return '{}';
        }

        return space
          ? `{${separator}${pairs.join(`,${separator}`)}${separator}${indent}}`
          : `{${pairs.join(',')}}`;
      } finally {
        seen.delete(val);
      }
    }

    // Fallback for unknown types
    return 'null';
  }

  function getIndentString(space: string | number): string {
    if (typeof space === 'number') {
      return ' '.repeat(Math.min(10, Math.max(0, Math.floor(space))));
    }
    return String(space).slice(0, 10);
  }

  return stringify(value, '', 0);
}

/**
 * Parses a stable-stringified JSON string back into a value.
 * This is just a wrapper around JSON.parse for consistency.
 *
 * @param text - The JSON string to parse
 * @returns Parsed value
 */
export function stableParse(text: string): JSONValue {
  return JSON.parse(text) as JSONValue;
}

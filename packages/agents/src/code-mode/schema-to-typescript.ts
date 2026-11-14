/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Projects a tool's registered JSON Schema onto a TypeScript type for the
 * declarations `discover_tool_api` hands to the model (issue #4084).
 *
 * Supported: objects (required and optional properties, `additionalProperties`
 * false, true or a schema), arrays, `enum`, `const`, `anyOf`/`oneOf`, `allOf`,
 * type lists, `nullable`, and local `$ref` into `definitions`/`$defs`, which
 * become named types (so recursive schemas terminate). Anything else (remote
 * references, tuples, unknown types, nesting past the depth bound) becomes
 * `unknown` with a diagnostic. The declarations are model guidance; the
 * original schema stays the validator when the call executes.
 */

const MAX_DEPTH = 24;
const MAX_NAMED_TYPES = 48;
const MAX_DOC_CHARS = 240;

type Schema = Readonly<Record<string, unknown>>;

/** Turns text from a schema or tool into a safe one-line doc comment body. */
export function docText(text: unknown, limit: number = MAX_DOC_CHARS): string {
  if (typeof text !== 'string') return '';
  const flat = Array.from(text)
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 0x20 || code === 0x7f ? ' ' : char;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\*\//g, '*\\/')
    .trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** An identifier made from arbitrary text (tool names may carry dots or dashes). */
export function typeIdentifier(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const joined = words
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join('');
  if (joined.length === 0) return 'T';
  return /^[0-9]/.test(joined) ? `T${joined}` : joined;
}

function isSchema(value: unknown): value is Schema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function literal(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function union(parts: readonly string[]): string {
  const unique = [...new Set(parts)];
  if (unique.length === 0) return 'never';
  return unique.length === 1 ? unique[0] : unique.join(' | ');
}

function wrapForArray(type: string): string {
  return /^[A-Za-z0-9_"]+$/.test(type) ? type : `(${type})`;
}

/** Builds the declarations of one tool's argument schema. */
export class SchemaProjection {
  readonly diagnostics: string[] = [];
  /** Named types in creation order: name -> body. */
  readonly namedTypes = new Map<string, string>();
  private readonly refNames = new Map<string, string>();

  constructor(
    private readonly root: unknown,
    private readonly baseName: string,
  ) {}

  project(): string {
    return this.convert(this.root, 'args', 0);
  }

  private diagnose(path: string, reason: string): string {
    this.diagnostics.push(`${path}: ${reason}; typed as unknown`);
    return 'unknown';
  }

  private convert(schema: unknown, path: string, depth: number): string {
    if (schema === true) return 'JsonValue';
    if (schema === false) return 'never';
    if (!isSchema(schema)) return this.diagnose(path, 'not a schema object');
    if (depth > MAX_DEPTH)
      return this.diagnose(path, `nested deeper than ${MAX_DEPTH} levels`);
    const type = this.convertCore(schema, path, depth);
    return schema['nullable'] === true ? union([type, 'null']) : type;
  }

  private convertCore(schema: Schema, path: string, depth: number): string {
    if (typeof schema['$ref'] === 'string')
      return this.reference(schema['$ref'], path, depth);
    if ('const' in schema)
      return (
        literal(schema['const']) ?? this.diagnose(path, 'non-scalar const')
      );
    if (Array.isArray(schema['enum'])) return this.enumeration(schema, path);
    const alternatives = schema['anyOf'] ?? schema['oneOf'];
    if (Array.isArray(alternatives))
      return union(
        alternatives.map((entry, index) =>
          this.convert(entry, `${path}|${index}`, depth + 1),
        ),
      );
    if (Array.isArray(schema['allOf']))
      return schema['allOf']
        .map((entry, index) =>
          wrapForArray(this.convert(entry, `${path}&${index}`, depth + 1)),
        )
        .join(' & ');
    return this.byType(schema, path, depth);
  }

  private enumeration(schema: Schema, path: string): string {
    const values = schema['enum'] as readonly unknown[];
    const literals = values.map(literal);
    if (literals.some((entry) => entry === undefined))
      return this.diagnose(path, 'enum with non-scalar values');
    return union(literals as string[]);
  }

  private byType(schema: Schema, path: string, depth: number): string {
    const declared = schema['type'];
    if (Array.isArray(declared))
      return union(
        declared.map((entry) =>
          this.single({ ...schema, type: entry }, path, depth),
        ),
      );
    if (declared === undefined) {
      if (isSchema(schema['properties']))
        return this.objectType(schema, path, depth);
      if (schema['items'] !== undefined)
        return this.arrayType(schema, path, depth);
      return 'JsonValue';
    }
    return this.single(schema, path, depth);
  }

  private single(schema: Schema, path: string, depth: number): string {
    switch (schema['type']) {
      case 'string':
        return 'string';
      case 'number':
      case 'integer':
        return 'number';
      case 'boolean':
        return 'boolean';
      case 'null':
        return 'null';
      case 'array':
        return this.arrayType(schema, path, depth);
      case 'object':
        return this.objectType(schema, path, depth);
      default:
        return this.diagnose(
          path,
          `unsupported type ${String(schema['type'])}`,
        );
    }
  }

  private arrayType(schema: Schema, path: string, depth: number): string {
    const items = schema['items'];
    if (items === undefined) return 'JsonValue[]';
    if (Array.isArray(items))
      return `${this.diagnose(`${path}[]`, 'tuple items')}[]`;
    return `${wrapForArray(this.convert(items, `${path}[]`, depth + 1))}[]`;
  }

  private objectType(schema: Schema, path: string, depth: number): string {
    const properties = isSchema(schema['properties'])
      ? schema['properties']
      : {};
    const required = new Set(
      Array.isArray(schema['required'])
        ? schema['required'].filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
    );
    const indent = '  '.repeat(depth + 1);
    const members = Object.entries(properties).map(([key, value]) => {
      const doc = isSchema(value) ? docText(value['description']) : '';
      const comment = doc.length > 0 ? `${indent}/** ${doc} */\n` : '';
      const optional = required.has(key) ? '' : '?';
      const type = this.convert(value, `${path}.${key}`, depth + 1);
      return `${comment}${indent}${JSON.stringify(key)}${optional}: ${type};`;
    });
    const extra = this.indexSignature(schema, path, depth, members.length);
    if (extra !== undefined) members.push(`${indent}${extra}`);
    if (members.length === 0) return 'Record<string, never>';
    return `{\n${members.join('\n')}\n${'  '.repeat(depth)}}`;
  }

  private indexSignature(
    schema: Schema,
    path: string,
    depth: number,
    known: number,
  ): string | undefined {
    const additional = schema['additionalProperties'];
    if (additional === false) return undefined;
    // Properties the schema does not name are left out of the guidance
    // unless the schema says what they hold.
    if (additional === undefined || additional === true)
      return known === 0 ? '[key: string]: JsonValue;' : undefined;
    if (known > 0) return '[key: string]: unknown;';
    return `[key: string]: ${this.convert(additional, `${path}{}`, depth + 1)};`;
  }

  private reference(ref: string, path: string, depth: number): string {
    const match = /^#\/(definitions|\$defs)\/([^/]+)$/.exec(ref);
    if (match === null) return this.diagnose(path, `unsupported $ref ${ref}`);
    const existing = this.refNames.get(ref);
    if (existing !== undefined) return existing;
    const container = isSchema(this.root) ? this.root[match[1]] : undefined;
    const target = isSchema(container) ? container[match[2]] : undefined;
    if (target === undefined)
      return this.diagnose(path, `unresolved $ref ${ref}`);
    if (this.namedTypes.size >= MAX_NAMED_TYPES)
      return this.diagnose(path, `more than ${MAX_NAMED_TYPES} named types`);
    const name = this.uniqueName(
      `${this.baseName}_${typeIdentifier(match[2])}`,
    );
    this.refNames.set(ref, name);
    this.namedTypes.set(name, 'unknown');
    this.namedTypes.set(name, this.convert(target, ref, depth + 1));
    return name;
  }

  private uniqueName(candidate: string): string {
    let name = candidate;
    for (let suffix = 2; this.namedTypes.has(name); suffix++)
      name = `${candidate}${suffix}`;
    return name;
  }
}

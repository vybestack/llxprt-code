/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

const ENVELOPE_FIELDS = new Set(['v', 'seq', 'ts', 'type', 'payload']);
const METADATA_FIELDS = new Set([
  'sessionId',
  'projectHash',
  'provider',
  'model',
  'startTime',
  'workspaceDirs',
  'cwd',
  'kind',
  'parentSessionId',
  'name',
  'title',
  'checkpointId',
  'parentSequence',
  'checkpointName',
  'directories',
  'severity',
  'message',
]);
// Per-envelope external metadata policy, independent of journal row count.
// Charge four bytes per encoded UTF-16 unit for token plus decoded text, and
// 128 per selected value for a scalar/reference/property/container allowance.
// This is allocation accounting, not a measurement of engine heap overhead.
export const METADATA_PROJECTION_LIMITS = {
  characters: 16 * 1024 * 1024,
  containers: 65536,
  values: 262144,
  allocationBytes: 64 * 1024 * 1024,
} as const;
const MAX_METADATA_CHARACTERS = METADATA_PROJECTION_LIMITS.characters;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}
type Expectation =
  | 'keyOrEnd'
  | 'key'
  | 'colon'
  | 'value'
  | 'valueOrEnd'
  | 'commaOrEnd';
interface Frame {
  readonly kind: 'object' | 'array';
  readonly path: ReadonlyArray<string | number>;
  readonly start: number;
  index: number;
  readonly retained: boolean;
  readonly value: JsonObject | JsonValue[];
  expectation: Expectation;
  key: string;
}

export interface JsonProjectionOptions {
  readonly maxTokenBytes?: number;
  readonly scalar?: (
    path: ReadonlyArray<string | number>,
    value: JsonValue,
  ) => boolean;
  readonly begin?: (path: ReadonlyArray<string | number>) => void;
  readonly retain?: (path: ReadonlyArray<string | number>) => boolean;
  readonly container?: (
    path: ReadonlyArray<string | number>,
    value: JsonValue,
    start: number,
    end: number,
    count: number,
  ) => JsonValue | undefined;
}

export class MetadataJsonProjection {
  constructor(private readonly options: JsonProjectionOptions = {}) {}
  private position = 0;
  private characterBytes = 0;
  private readonly stack: Frame[] = [];
  private root: JsonValue = null;
  private complete = false;
  private mode: 'idle' | 'string' | 'primitive' = 'idle';
  private token = '';
  private retainToken = false;
  private keyToken = false;
  private escaped = false;
  private unicodeDigits = 0;
  private metadataCharacters = 0;
  private metadataContainers = 0;
  private metadataValues = 0;
  private allocationBytes = 0;
  private maxTokenCharacters = 0;

  private reserveMetadata(
    characters: number,
    values: number,
    containers: number,
  ): void {
    if (this.options.retain !== undefined) return;
    const nextCharacters = this.metadataCharacters + characters;
    const nextValues = this.metadataValues + values;
    const nextContainers = this.metadataContainers + containers;
    const nextBytes = this.allocationBytes + characters * 4 + values * 128;
    this.checkMetadataLimit('characters', nextCharacters);
    this.checkMetadataLimit('values', nextValues);
    this.checkMetadataLimit('containers', nextContainers);
    this.checkMetadataLimit('allocationBytes', nextBytes);
    this.metadataCharacters = nextCharacters;
    this.metadataValues = nextValues;
    this.metadataContainers = nextContainers;
    this.allocationBytes = nextBytes;
  }

  private checkMetadataLimit(
    dimension: keyof typeof METADATA_PROJECTION_LIMITS,
    value: number,
  ): void {
    if (value > METADATA_PROJECTION_LIMITS[dimension]) {
      throw new Error(
        `Journal metadata ${dimension} limit ${METADATA_PROJECTION_LIMITS[dimension]} exceeded at byte ${this.position}`,
      );
    }
  }

  push(chunk: string): void {
    for (const character of chunk) {
      this.characterBytes = Buffer.byteLength(character);
      this.accept(character);
      this.position += this.characterBytes;
    }
  }

  finish(): unknown {
    if (this.mode === 'primitive') this.finishPrimitive();
    if (this.mode !== 'idle' || this.stack.length !== 0 || !this.complete) {
      throw new SyntaxError('Incomplete journal JSON');
    }
    return this.root;
  }

  metrics(): {
    readonly maxTokenCharacters: number;
    readonly metadataCharacters: number;
    readonly metadataContainers: number;
    readonly metadataValues: number;
    readonly allocationBytes: number;
  } {
    return {
      maxTokenCharacters: this.maxTokenCharacters,
      metadataCharacters: this.metadataCharacters,
      metadataContainers: this.metadataContainers,
      metadataValues: this.metadataValues,
      allocationBytes: this.allocationBytes,
    };
  }

  private top(): Frame | undefined {
    return this.stack.length === 0
      ? undefined
      : this.stack[this.stack.length - 1];
  }

  private accept(character: string): void {
    if (this.mode === 'string') {
      this.acceptString(character);
      return;
    }
    if (this.mode === 'primitive') {
      if (!/[\s,\]}]/u.test(character)) {
        this.appendToken(character);
        return;
      }
      this.finishPrimitive();
    }
    if (' \t\r\n'.includes(character)) return;
    const frame = this.top();
    if (frame === undefined) {
      if (this.complete) throw new SyntaxError('Extra journal JSON value');
      this.startValue(character);
      return;
    }
    this.acceptFrame(frame, character);
  }

  private acceptFrame(frame: Frame, character: string): void {
    switch (frame.expectation) {
      case 'keyOrEnd':
        if (character === '}') {
          this.closeFrame();
          return;
        }
        this.startKey(character, frame);
        return;
      case 'key':
        this.startKey(character, frame);
        return;
      case 'colon':
        if (character !== ':') throw new SyntaxError('Expected JSON colon');
        frame.expectation = 'value';
        return;
      case 'valueOrEnd':
        if (character === ']') {
          this.closeFrame();
          return;
        }
        this.startValue(character);
        return;
      case 'value':
        this.startValue(character);
        return;
      case 'commaOrEnd':
        if (character === (frame.kind === 'object' ? '}' : ']')) {
          this.closeFrame();
        } else if (character === ',') {
          frame.expectation = frame.kind === 'object' ? 'key' : 'value';
        } else {
          throw new SyntaxError('Expected JSON comma or closing delimiter');
        }
        return;
      default:
        throw new SyntaxError('Invalid JSON parser state');
    }
  }

  private startKey(character: string, frame: Frame): void {
    if (character !== '"') throw new SyntaxError('Expected JSON property');
    this.startString(this.options.retain !== undefined || frame.retained, true);
  }

  private valuePath(): ReadonlyArray<string | number> {
    const frame = this.top();
    return frame === undefined
      ? []
      : [...frame.path, frame.kind === 'array' ? frame.index : frame.key];
  }

  private retainValue(): boolean {
    if (this.options.retain !== undefined)
      return this.options.retain(this.valuePath());
    const frame = this.top();
    if (frame === undefined) return true;
    if (!frame.retained) return false;
    if (frame.kind === 'array') return true;
    if (this.stack.length === 1) return ENVELOPE_FIELDS.has(frame.key);
    if (this.stack.length === 2 && this.stack[0].key === 'payload') {
      return METADATA_FIELDS.has(frame.key);
    }
    return true;
  }

  private startValue(character: string): void {
    this.options.begin?.(this.valuePath());
    const retained = this.retainValue();
    if (retained) {
      this.reserveMetadata(
        0,
        1,
        character === '{' || character === '[' ? 1 : 0,
      );
    }
    if (character === '{' || character === '[') {
      if (this.stack.length >= 256) throw new SyntaxError('JSON nesting limit');
      const kind = character === '{' ? 'object' : 'array';
      this.stack.push({
        kind,
        path: this.valuePath(),
        start: this.position,
        index: 0,
        retained,
        value: kind === 'object' ? {} : [],
        expectation: kind === 'object' ? 'keyOrEnd' : 'valueOrEnd',
        key: '',
      });
    } else if (character === '"') {
      this.startString(retained, false);
    } else if (/[-0-9tfn]/u.test(character)) {
      if (retained) this.reserveMetadata(1, 0, 0);
      this.mode = 'primitive';
      this.token = character;
      this.retainToken = retained;
      this.keyToken = false;
    } else {
      throw new SyntaxError('Invalid JSON value');
    }
  }

  private startString(retained: boolean, key: boolean): void {
    if (retained) this.reserveMetadata(1, 0, 0);
    this.mode = 'string';
    this.token = retained ? '"' : '';
    this.retainToken = retained;
    this.keyToken = key;
    this.escaped = false;
    this.unicodeDigits = 0;
  }

  private appendToken(character: string): void {
    const bytes = (this.token.length + character.length) * 4;
    if (
      this.options.maxTokenBytes !== undefined &&
      bytes > this.options.maxTokenBytes
    )
      throw new RangeError('Journal projection token exceeds allocation bound');
    if (this.retainToken) this.reserveMetadata(character.length, 0, 0);
    this.token += character;
    this.maxTokenCharacters = Math.max(
      this.maxTokenCharacters,
      this.token.length,
    );
    if (this.token.length > MAX_METADATA_CHARACTERS) {
      throw new SyntaxError('Journal metadata token exceeds limit');
    }
  }

  private acceptString(character: string): void {
    if (this.retainToken) this.appendToken(character);
    if (this.unicodeDigits > 0) {
      if (!/[0-9a-f]/iu.test(character))
        throw new SyntaxError('Invalid Unicode escape');
      this.unicodeDigits -= 1;
    } else if (this.escaped) {
      if (!'"\\/bfnrtu'.includes(character))
        throw new SyntaxError('Invalid JSON escape');
      if (character === 'u') this.unicodeDigits = 4;
      this.escaped = false;
    } else if (character === '\\') {
      this.escaped = true;
    } else if (character === '"') {
      this.finishString();
    } else if (character.charCodeAt(0) < 32) {
      throw new SyntaxError('Unescaped JSON control character');
    }
  }

  private finishString(): void {
    const value: unknown = this.retainToken ? JSON.parse(this.token) : '';
    if (typeof value !== 'string')
      throw new SyntaxError('Expected JSON string');
    this.token = '';
    this.mode = 'idle';
    if (this.keyToken) {
      const frame = this.top();
      if (frame === undefined) throw new SyntaxError('JSON key outside object');
      frame.key = value;
      frame.expectation = 'colon';
    } else {
      this.completeScalar(value);
    }
  }

  private finishPrimitive(): void {
    if (
      !/^(?:null|true|false|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)$/u.test(
        this.token,
      )
    ) {
      throw new SyntaxError('Invalid JSON primitive');
    }
    const value: unknown = JSON.parse(this.token);
    if (
      value !== null &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new SyntaxError('Expected JSON primitive');
    }
    this.token = '';
    this.mode = 'idle';
    this.completeScalar(value);
  }

  private completeScalar(value: JsonValue): void {
    const retained = this.options.scalar?.(this.valuePath(), value) ?? true;
    this.completeValue(value, this.retainToken && retained);
  }

  private closeFrame(): void {
    const frame = this.stack.pop();
    if (frame === undefined) throw new SyntaxError('Unexpected JSON delimiter');
    const value =
      this.options.container === undefined
        ? frame.value
        : this.options.container(
            frame.path,
            frame.value,
            frame.start,
            this.position + this.characterBytes,
            frame.index,
          );
    this.completeValue(value ?? null, frame.retained && value !== undefined);
  }

  private completeValue(value: JsonValue, retained: boolean): void {
    const frame = this.top();
    if (frame === undefined) {
      this.root = value;
      this.complete = true;
      return;
    }
    if (retained) {
      if (Array.isArray(frame.value)) frame.value.push(value);
      else
        Object.defineProperty(frame.value, frame.key, {
          value,
          enumerable: true,
          configurable: true,
        });
    }
    frame.index += 1;
    frame.expectation = 'commaOrEnd';
  }
}

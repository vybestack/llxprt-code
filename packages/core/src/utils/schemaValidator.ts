/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import AjvPkg from 'ajv';
// Ajv's ESM/CJS interop: use 'any' for compatibility as recommended by Ajv docs
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = (AjvPkg as any).default || AjvPkg;
const ajValidator = new AjvClass();

/**
 * Simple utility to validate objects against JSON Schemas
 */
export class SchemaValidator {
  /**
   * Returns null if the data confroms to the schema described by schema (or if schema
   *  is null). Otherwise, returns a string describing the error.
   */
  static validate(schema: unknown | undefined, data: unknown): string | null {
    if (!schema) {
      return null;
    }
    if (typeof data !== 'object' || data === null) {
      return 'Value of params must be an object';
    }
<<<<<<< HEAD

    const objectSchema = this.toObjectSchema(schema);
    const validate = ajValidator.compile(objectSchema);
=======
    const validate = ajValidator.compile(schema);
>>>>>>> d9fb08c9 (feat: migrate tools to use parametersJsonSchema. (#5330))
    const valid = validate(data);

    if (!valid && validate.errors) {
      const errorText = ajValidator.errorsText(validate.errors, {
        dataVar: 'params',
      });
      return errorText;
    }

    return null;
  }
}

import { itProp } from '@fast-check/vitest';
// import * as vitest from 'vitest'; // Not needed, only itProp is used

// Only add new functions to the global scope, don't override existing ones
global.itProp = itProp;

// Local value + type declarations (the originals behind the aliases).
export declare const Internal: number;
export type InternalType = string;
// Aliased LOCAL named export — must record the alias (PublicAlias),
// not Internal.
export { Internal as PublicAlias };
// Unaliased local named export — records its sole name.
export { InternalType };
// Aliased re-export — must record the alias (PublicType/AlsoPublic),
// not the original (Hidden/Value).
export type { Hidden as PublicType } from './types.js';
export { Value as AlsoPublic } from './types.js';

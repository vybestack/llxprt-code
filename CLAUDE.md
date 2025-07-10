# Project Guidelines for Claude

## Code Quality Rules

### TypeScript

- **Don't use `any`** - Always specify proper types. Use `unknown` if the type is truly unknown and add proper type guards.

## Linting

- Always run `npm run lint` before considering work complete
- Fix all linting errors, including warnings about `any` types
- Run `npm run typecheck` to ensure type safety

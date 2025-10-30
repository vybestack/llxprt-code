## Completion Checklist

Before reporting a task as finished, run the following commands from the repository root:

1. `npm run format:check`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run test`
5. `npm run build`
6. `node scripts/start.js --profile-load synthetic --prompt "just say hi"`

Ensure each command succeeds (exit code 0). If any command fails, resolve the issues and rerun the sequence.

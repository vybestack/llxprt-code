The script runner could not access the host environment or filesystem, and no request was made to `example.com`.

- `process.env`: `ReferenceError: 'process' is not defined`
- `require('fs').readdirSync('/')`: `ReferenceError: 'require' is not defined`
- `globalThis.Bun`: `undefined` (no error)
- `fetch('https://example.com')`: `ReferenceError: 'fetch' is not defined`

The TODO list is complete.

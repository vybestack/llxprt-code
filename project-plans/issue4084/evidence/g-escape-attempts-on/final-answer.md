The probes returned:

- `process.env`: `ReferenceError: 'process' is not defined`
- `require('fs').readdirSync('/')`: `ReferenceError: 'require' is not defined`
- `globalThis.Bun`: `undefined` (no error)
- `fetch('https://example.com')`: `ReferenceError: 'fetch' is not defined`

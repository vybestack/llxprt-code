# o200k_base fixture provenance

These static ordinary-text fixtures were generated with OpenAI's `o200k_base`
encoding semantics (`encode_ordinary`; equivalent here to
`@dqbd/tiktoken` `encode(text, [], [])`). The production implementation does
not generate its oracle values at test time.

- Encoding: `o200k_base`
- Official BPE source SHA-256:
  `446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`
- JavaScript runtime codec: `@dqbd/tiktoken@1.0.22`
- Local encoder JSON SHA-256:
  `df53e1a5f146e33a1b144d12ad9d685ee1b54dbc8b0950791ed45c933b119dc1`
- Local WASM SHA-256:
  `dedd9a7b5d8d98b44448bedb371ade1c5327f7bb5dd9effe159da816473a415f`
- Reference generation: Python OpenAI `tiktoken.get_encoding('o200k_base').encode_ordinary(text)`.

The deterministic long case uses 100,000 repeated `x` characters. This stays
within the established local codec's supported range while proving bounded
long-input behavior without changing dependencies.

# Tokenizer Asset Licenses and Notices

This directory redistributes pinned, offline tokenizer BPE rank files for
three model families. Each asset is pinned by upstream HuggingFace revision
and SHA-256 checksum. No network access is required at runtime.

## Kimi K3 — kimi-k3/tokenizer.bpe

- **Source**: https://huggingface.co/moonshotai/Kimi-K3
- **Upstream file**: tiktoken.model
- **Upstream revision**: 9f62e4e9fffbd0a83ddd60e1c209d828994b3569
- **Conversion**: Direct (already tiktoken BPE format, no conversion needed)
- **License**: Kimi K3 License — bundled at kimi-k3/LICENSE

## GLM 5.2 — glm-5.2/tokenizer.bpe

- **Source**: https://huggingface.co/zai-org/GLM-5.2
- **Upstream file**: tokenizer.json
- **Upstream revision**: b4734de4facf877f85769a911abafc5283eab3d9
- **Conversion**: HuggingFace BPE vocabulary converted to tiktoken BPE rank
  format via the standard GPT-2 byte-to-unicode inverse mapping
- **License**: MIT — bundled at glm-5.2/LICENSE

## MiniMax M3 — minimax-m3/tokenizer.bpe

- **Source**: https://huggingface.co/MiniMaxAI/MiniMax-M3
- **Upstream file**: tokenizer.json
- **Upstream revision**: f0e1c1e04d40177e4673a22097036854f536e9c0
- **Conversion**: HuggingFace BPE vocabulary converted to tiktoken BPE rank
  format via the standard GPT-2 byte-to-unicode inverse mapping
- **License**: MiniMax Community License — bundled at minimax-m3/LICENSE
  (nonstandard: restricts commercial use; see LICENSE for full terms)

## Verification

Each manifest.json records the SHA-256 checksum verified at load time.
If a checksum does not match, the loader throws an actionable error and
no tokenization occurs (no silent fallback to word/char estimation).

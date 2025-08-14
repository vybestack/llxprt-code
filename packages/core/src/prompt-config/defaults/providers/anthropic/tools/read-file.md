# read_file Tool

**Parameter**: Use `absolute_path` for the file path (required)

The path must be absolute, starting with /. For example:

- Correct: `/Users/name/project/src/index.js`
- Wrong: `src/index.js` or `./src/index.js`

When reading files:

- Large files will be automatically truncated
- Use `offset` and `limit` parameters to paginate through large files
- The tool handles text, images, and PDFs

# Fix for regex escaping issue

The issue is that the escape character `\` in the regex is being interpreted as a line continuation in the write_file tool.

Original code:

```ts
const lf = text.replace(/\r\n?/g, '\n');
```

Needs to be written as:

```ts
const lf = text.replace(/\\r\\n?/g, '\n');
```

This fix will address issue #618 where subagent output overwrites itself on one line instead of spanning multiple lines.

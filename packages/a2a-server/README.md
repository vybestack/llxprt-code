# Gemini CLI A2A Server

## All code in this package is experimental and under active development

This package contains the A2A server implementation for the Gemini CLI.

If the a2a-server is activated again, its configuration must receive provider
composition from its consumers before creating a content generator. Agents
binds the selected tokenizer independently from acquiring a content-generator
factory; configuration does not supply a runtime factory graph. The retired
Gemini authentication selection and refresh path has been removed, and the
server does not declare a direct dependency on the providers package.

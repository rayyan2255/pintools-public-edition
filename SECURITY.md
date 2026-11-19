# Security and responsible use

PinTools Public Edition is a static, browser-only BYOK application. It does not have a PinTools backend and does not receive AI provider keys on a PinTools server.

## Important API key warning

Keys are held in the current tab's `sessionStorage` so they survive refreshes. This storage is not a secure vault. JavaScript running on the same origin, including malicious injected scripts or browser extensions with sufficient access, may be able to read the key.

Use:
- Restricted API keys.
- Provider-side spending limits and budgets.
- Separate keys for testing.
- Key revocation after use.

Do not use organization master keys or keys with broad administrative permissions.

## Provider requests

Requests are sent directly from the browser to OpenAI, Anthropic or Google. Provider CORS and organization policies may block direct browser use. PinTools does not proxy requests or work around provider restrictions.

## Reporting issues

Do not include API keys, authorization headers, account IDs, private articles or personal data in public GitHub issues. Remove credentials from screenshots and logs before reporting a problem.

This repository is public. The prompt templates are visible by design and must not contain secrets.

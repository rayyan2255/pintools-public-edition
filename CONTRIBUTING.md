# Contributing to PinTools

Thanks for considering a contribution.

## Before submitting
- Keep the application static: no server backend, no database, no login.
- Do not add analytics, tracking or third-party proxy services.
- Never add API keys, secrets, user exports or generated user content.
- Preserve all nine generators and both workflows unless a deliberate product decision is approved.
- Preserve exact idea-count handling and missing-idea recovery.
- Preserve optional image-generation confirmations and the text-only Automated Article Creator.
- Keep the Prompt Library hidden from the public UI.
- Respect reduced-motion preferences.

## Validation
Run `node --check app.js` and `python -m unittest discover -s tests -v` before submitting a pull request.

Live provider tests must use the contributor's own API keys. Do not put keys in test fixtures, commits or issue reports.

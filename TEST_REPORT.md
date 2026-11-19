# PinTools Public Edition 1.5.0 — Test Report

## Automated validation

- JavaScript syntax check (`node --check app.js`): **PASS**
- Public Edition contract tests: **24/24 PASS**
- Mocked OpenAI text and image request construction: **PASS**
- Mocked Claude Messages request construction: **PASS**
- Mocked Gemini text and image request construction: **PASS**
- Provider response parsing: **PASS**
- Exact 28-idea plan parsing and merge test: **PASS**
- Automated workflow text-only contract: **PASS**
- Exact requested idea count and repair-loop checks: **PASS**
- Image skip and alt-text alignment checks: **PASS**
- Four-pin batch contract: **PASS**
- Session storage and IndexedDB isolation checks: **PASS**
- Hidden Prompt Library UI check: **PASS**
- Warnings, animations and reduced-motion checks: **PASS**
- GitHub Pages deployment file checks: **PASS**

## Static HTTP smoke test

The following static assets were served successfully with HTTP 200 from a local static web server:

- `/`: HTTP 200
- `/index.html`: HTTP 200
- `/app.js`: HTTP 200
- `/styles.css`: HTTP 200
- `/prompts.json`: HTTP 200
- `/favicon.svg`: HTTP 200
- `/CNAME`: HTTP 200

## Source package checks

- No Python backend included.
- No `/api/` backend calls in the runtime.
- No `localStorage` use in the runtime.
- 13 active runtime prompt templates included.
- 11 original prompt source files included.
- MIT license included.
- GitHub Pages workflow, CNAME and `.nojekyll` included.

## Not yet verified

1. Real provider calls were not made because no user API keys were supplied.
2. Provider CORS and organization/browser-access restrictions must be tested using restricted test API keys.
3. Real image generation and provider billing were not tested.
4. Full interactive browser rendering was not completed in this execution environment; the headless Chromium process failed at the environment level. Static HTTP and JavaScript contract tests passed.

## Release status

**Build package prepared for user testing and GitHub upload. Not yet deployed to a public GitHub repository or custom domain.**

Before public announcement, test each provider with a restricted API key and confirm that the selected model is available to that account.

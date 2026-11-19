# PinTools by Rayyan — Public Edition 1.5.0

A free, open-source, browser-based AI content studio for bloggers and Pinterest creators.

PinTools brings nine individual generators, a guided Complete Content Workflow, and a text-only Automated Article Creator into one static website. Users connect their own AI provider accounts (BYOK), generate content, and download their work.

**No account. No PinTools API credits. No application backend. No server-side database.**

> **Public beta warning:** This edition makes AI requests directly from the user's browser to the selected provider. API keys are kept in tab-scoped `sessionStorage` so they survive refreshes. Browser scripts and extensions may be able to read them. Use restricted API keys with spending limits. Do not use organization master keys.

## Features

### Nine individual generators
1. Pinterest Title Generator
2. Ideas Generator
3. Image Prompt Generator
4. Image Generator
5. Article Writer
6. Featured Image Generator
7. Featured Image Prompt Generator
8. Pin Description Generator
9. Pinterest Pin Generator

### Two production workflows
- **Complete Content Workflow:** Guided, sequential production with optional idea images, featured image and Pinterest pins. Skipping image generation preserves image prompts and alt texts.
- **Automated Article Creator:** Select a title and automatically generate the article plan, the exact requested number of ideas, each idea's image prompt and alt text, the article, featured-image prompt, four Pinterest titles and four matching descriptions. It does not call the image-generation API.

### AI providers
- **Text:** OpenAI, Claude (Anthropic), Google Gemini.
- **Images:** OpenAI Images and Google Gemini Image.
- Text and image settings are independent. Model IDs are editable.

### Exports
- Individual TXT files for generated text components.
- Article HTML.
- Project JSON including generated image data.
- Session backup JSON.
- Individual generated image downloads.

### Session behaviour
- Project and workflow data are stored in tab-scoped `sessionStorage`.
- Generated image bytes are stored in IndexedDB with a unique tab-session ID.
- Refreshing the page restores the same tab's work.
- A new tab session starts with an empty workspace.
- The app marks a session as closed on `pagehide` and cleans expired image records on a later launch. Browser storage cleanup is best-effort; browsers control when physical storage is reclaimed.
- **End Session & Clear Everything** clears the current session's projects, API keys and image records immediately.

The Prompt Library is intentionally hidden from the public interface. Prompt templates remain in `prompts.json` and the prompt source folder because this is an open-source repository; they are not secret.

## Run locally

No installation or build step is required.

1. Download or clone this repository.
2. Open `index.html` using a local static web server (recommended), or use GitHub Pages after deployment.
3. Open **Settings**.
4. Configure Text AI and/or Image AI separately.
5. Save the connection, then use **Test connection**.
6. Create a project and generate content.

For a quick local static server with Python installed:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Opening the page with `file://` may prevent `fetch('./prompts.json')` from working. Use a local static server or the deployed website.

## Deploy to GitHub Pages

This repository includes `.github/workflows/deploy.yml`.

1. Create a **public** GitHub repository.
2. Upload the contents of this folder to the repository root.
3. In GitHub, open **Settings → Pages**.
4. Set the build and deployment source to **GitHub Actions**.
5. Push to the `main` branch. The included workflow publishes the static site.
6. For a custom domain, edit `CNAME` if needed and create a DNS CNAME record pointing your chosen subdomain to `<your-github-username>.github.io`.
7. Wait for DNS and certificate provisioning, then enable **Enforce HTTPS** in GitHub Pages settings.

The included `CNAME` is initially set to `studio.lilydwelling.com` as the proposed subdomain. Change it before deployment if you choose a different hostname.

## Configure AI providers

Open **Settings** and configure the two provider areas independently.

### Text AI
- OpenAI default model: `gpt-6-luna`
- Claude default model: `claude-sonnet-5`
- Gemini default model: `gemini-3.6-flash`

### Image AI
- OpenAI Images default model: `gpt-image-2.6-flare`
- Gemini Image default model: `gemini-3.1-flash-image`

These are starting defaults, not guarantees of access. Model availability, account permissions, pricing and provider API details can change. Use a model ID enabled for your provider account.

Official provider documentation:
- OpenAI Responses API: https://developers.openai.com/api/reference/responses/overview
- OpenAI image generation: https://developers.openai.com/api/docs/guides/image-generation
- Anthropic models: https://platform.claude.com/docs/en/about-claude/models/overview
- Gemini API: https://ai.google.dev/api/generate-content
- Gemini model catalog: https://ai.google.dev/gemini-api/docs/models
- Gemini image generation: https://ai.google.dev/gemini-api/docs/image-generation
- Gemini pricing and image models: https://ai.google.dev/gemini-api/docs/pricing

## Important provider/browser limitations

PinTools intentionally does not include a proxy or backend. This means:
- Requests are made directly from the browser to the provider.
- A provider may block browser requests because of CORS, organization policy or direct-browser-access restrictions.
- Anthropic browser access uses its explicit direct-browser-access header; an account or organization may still disallow it.
- If a provider blocks the request, PinTools displays a browser-access/CORS error. It will not silently send the key through a third-party proxy.
- Direct browser use exposes keys to the browser environment. This is a BYOK experimental public tool, not a secure multi-user SaaS.

Never commit API keys to GitHub. PinTools does not send API keys to a PinTools server, but any JavaScript running on the page's origin can potentially read session storage. Use restricted keys, spending limits and revoke them when finished.

AI generation is not free merely because PinTools is free. The user is responsible for provider charges. Image generation and image connection tests can incur charges and require confirmation.

## Privacy and data

- No login or registration.
- No PinTools-owned database.
- No cloud project storage.
- No central API-key collection.
- No analytics or tracking code added by PinTools.
- Provider requests go directly from the browser to the selected provider.
- Export files are saved to the user's device and are not automatically uploaded.
- API keys are not included in project exports or session backups.

The app loads the Poppins font from Google Fonts. If you require fully offline operation, download and self-host the font files and update the CSS.

## Session storage notes

`sessionStorage` survives refreshes in the same tab and is cleared by the browser when the tab session ends. Generated images use IndexedDB so they survive refreshes. IndexedDB does not provide a reliable synchronous "delete on tab close" browser event. PinTools uses session IDs, a close marker and cleanup on a later launch. A new tab cannot see a previous session's images or projects, even if the browser has not physically reclaimed old IndexedDB bytes yet.

For immediate cleanup, use **Settings → End Session & Clear Everything** before closing the tab.

## Development checks

Run:

```bash
node --check app.js
python -m unittest discover -s tests -v
```

Live provider tests require your own API keys and may incur charges. They are not part of the offline automated test suite.

## License

MIT. See [LICENSE](LICENSE).

# Changelog

## 1.5.0 — Public Edition initial build

- Rebranded the public application as PinTools by Rayyan.
- Started from the delivered Version 1.4.2 frontend and prompt baseline.
- Removed the Prompt Library from the public-facing UI while retaining active prompt templates in source.
- Replaced local Python backend calls with direct browser-to-provider adapters for OpenAI, Claude and Gemini text, plus OpenAI Images and Gemini Image.
- Moved project and preference persistence to tab-scoped sessionStorage.
- Added session-scoped IndexedDB image records so generated images survive page refreshes.
- Added session markers, expired-session cleanup and End Session & Clear Everything.
- Added privacy, API-key and image-cost warnings.
- Added restrained loading, workflow, card and modal animations with reduced-motion support.
- Added public GitHub repository metadata, MIT license and GitHub Pages deployment workflow.
- Preserved the nine individual generators, Complete Content Workflow, Automated Article Creator, exact idea-count repair, optional image generation and four-pin batch logic.

### Known beta limitations

- Provider API requests are not live-verified without user API keys.
- Direct browser API requests may be blocked by provider CORS or organization settings.
- Browser-side API keys are accessible to scripts/extensions running in the page context; this is not production-grade secret storage.
- Browser-managed IndexedDB cleanup after a tab closes is best-effort. Use End Session & Clear Everything for immediate cleanup.

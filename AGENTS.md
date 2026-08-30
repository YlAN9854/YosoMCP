# AGENTS.md

## Project identity
Chrome extension (Manifest V3) built with [WXT](https://wxt.dev/), React 19, TypeScript, Tailwind CSS v4, and Zustand. Records browser interactions into structured action trees, supports Replay-based continuation and branch recording, infers parameter/loop roles, and exports versioned Clipboard/`.yoso` Trace Packages for the Trace Compiler and Browser Library Skills.

## Commands

```bash
npm install          # also runs wxt prepare → generates .wxt/tsconfig.json
npm run dev          # dev with HMR (outputs to .output/chrome-mv3)
npm run dev:firefox  # dev targeting Firefox
npm run build        # production build
npm run zip          # build + zip for distribution
npm run compile      # type-check only (tsc --noEmit) — no emit
npm test             # no-op placeholder (no real tests yet)
```

**Order matters:** `wxt prepare` (run via `postinstall`) generates `.wxt/tsconfig.json` which `tsconfig.json` extends. Without it, `tsc` and IDE intellisense fail. If you clone fresh, run `npm install` before anything else.

## Architecture

Three WXT entrypoints in `entrypoints/` (auto-discovered by WXT):

| Entry | Runs in | Purpose |
|-------|---------|---------|
| `background.ts` | Service worker | Message routing, storage (IndexedDB), recording/replay control, analysis, code generation |
| `content.ts` | Every page (`<all_urls>`, all frames) | Capture DOM events, replay actions, element pickers, selector inference |
| `sidepanel/` | Side panel (React) | UI: recording controls, operation tree, branch panel, settings |

**Supporting directories:**
- `content/` — content script modules (recorder, replayer, selectors, pickers)
- `background/` — background modules (analyzer/, generator/, storage/, controllers, services)
- `sidepanel/` — React UI (components/, hooks/, stores/, utils/)
- `types/` — shared TypeScript types
- `utils/` — shared helpers (currently just messaging wrappers)

## Message system

Three namespaces in `types/message.ts`:

| Constant | Direction | Purpose |
|----------|-----------|---------|
| `MSG` | Side Panel → Background | Commands (start recording, analyze, export, etc.) |
| `EVENT` | Background → Side Panel | Event push (action recorded, replay step, picker results) |
| `CS_MSG` | Background ↔ Content Script | Content script interaction (recording, replay, pickers) |

- Side Panel calls Background via `sendToBackground()` from `utils/messaging.ts`.
- Background calls Content Script via `sendToContentScript(tabId, type, data)`.
- Background broadcasts to Side Panel via `broadcastToSidePanel()`.
- Content script has a guard `__YOSO_CONTENT_SCRIPT_INITIALIZED__` on `window` to prevent double-init when WXT reloads.

## Important conventions

- **Import alias:** `@/` maps to project root (e.g. `@/types/message`, `@/background/storage`).
- **Generated dirs:** `.wxt/` and `.output/` are gitignored — never edit them.
- **Tailwind v4:** uses the `@tailwindcss/vite` Vite plugin (no PostCSS config, no `tailwind.config.ts`).
- **Auto-icons:** WXT module `@wxt-dev/auto-icons` generates extension icons from `assets/icon.svg` at build time.
- **Content script frame mode:** `allFrames: true` — the script runs in every frame, not just the main frame. Be aware of `frameId` when sending messages to content scripts.
- **No real test suite:** `npm test` is a `node -e` no-op. Manual testing in Chrome is the verification path. At minimum, run `npm run compile` to check types.
- All recorded actions are persisted in IndexedDB (via `background/storage/`).

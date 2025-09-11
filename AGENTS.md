# Repository Guidelines

## Project Structure & Module Organization
- `src/talk_to_figma_mcp/` — TypeScript MCP server (entry: `server.ts`), bundled to `dist/` via tsup.
- `src/socket.ts` — Bun WebSocket relay; reads `config/server-config.json` for `host`/`port`.
- `src/cursor_mcp_plugin/` — Figma plugin (`manifest.json`, `code.js`, `ui.html`).
- `config/` — JSON config and mapping data (`server-config.json`, `node_name_map.json`, etc.). No secrets.
- `scripts/setup.sh` — Creates `.cursor/mcp.json` for quick MCP setup.
- `dist/` — Build output. Do not edit by hand.
- Root test scripts — e.g., `test_*.js`, `quick_test.js` for manual E2E checks.

## Build, Test, and Development Commands
- `bun install` — Install dependencies.
- `bun run build` — Bundle TypeScript to `dist/` (tsup).
- `bun run dev` — Watch + rebuild during development.
- `bun socket` — Start WebSocket server (uses `config/server-config.json`).
- `bun start` — Run MCP server from `dist/server.js` over stdio.
- `bun run setup` — Write `.cursor/mcp.json` pointing to published package.
- Maintainers: `bun run pub:release` — Build and `npm publish`.

## Coding Style & Naming Conventions
- TypeScript (ES2022, ESM, Node 18 target). Prefer named exports; camelCase for vars/functions.
- Indentation: 2 spaces. Keep diffs focused; avoid sweeping refactors.
- Filenames: follow existing patterns; new TS files use kebab-case under `src/`. Plugin remains plain JS.
- No ESLint/Prettier configured; mirror existing style. Add minimal TSDoc where helpful.

## Testing Guidelines
- No formal test framework. Use root scripts for E2E against a live Figma session.
- Example: `bun socket` → open Figma plugin → join channel → `node test_base_properties.js`.
- For changes, add/adjust a small script (e.g., `test_new_feature.js`) demonstrating behavior.

## Commit & Pull Request Guidelines
- Use Conventional Commits (e.g., `feat: …`, `fix: …`, `test: …`), consistent with history.
- PRs include: clear description, linked issues, reproduction steps, and screenshots/GIFs for plugin UX.
- Call out any config changes (e.g., `config/server-config.json`).

## Security & Config Tips
- Do not commit secrets. `server.ts` redacts sensitive fields; keep logs clean.
- Edit `config/server-config.json` for networking; prefer localhost defaults.

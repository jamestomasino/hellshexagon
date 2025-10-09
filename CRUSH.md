# CRUSH.md: Hells Hexagon Agentic Guide

## Build, Lint, and Test Commands

- **Install dependencies:**
  - `npm install` (or `yarn`)
- **Full build:**
  - `npx prisma generate && npx prisma migrate deploy && npx nuxt build`
- **Dev server:**
  - `nuxi dev`
- **Netlify preview/dev:**
  - `netlify dev`
- **Run single test (if test directory exists):**
  - No standard tests detected; if using Vitest: `npx vitest run path/to/file.test.ts`
- **Generate DB types:**
  - `npx prisma generate`

## Formatting & Code Style Guidelines

- **Language/Framework:** Nuxt 3 (TypeScript), Prisma, Netlify Functions, Pinia store, Vue 3 Single File Components
- **Imports:**
  - Use absolute imports (e.g., `~/server/utils/db` for server code)
  - Prefer named imports, only use default where idiomatic (ex: Vue SFCs)
- **Types:**
  - Use TypeScript for all code (.ts, .vue `<script setup lang="ts">`)
  - Always specify parameter and return types for exported functions
  - Prefer explicit types for API route handlers and composables
- **Naming Conventions:**
  - camelCase for variables, functions, and composables (e.g. `useRoom`)
  - PascalCase for components/files (e.g. `HexBoard.vue`)
  - snake_case for env vars and some db fields
- **Formatting:**
  - 2-space indentation; single quotes for JS/TS/JSON
  - Omit trailing semicolons unless required
  - Prefer trailing commas in multiline objects/arrays
- **Error Handling:**
  - Server: Always perform server validation (never trust client input)
  - Send errors using `sendError(event, createError({...}))` (Nitro idiom)
  - Surface only the necessary error details to clients
- **API Design:**
  - Organize server routes under `/server/api/*.ts`
  - Use Prisma client for all DB access; never raw SQL
  - Endpoints should validate and sanitize all input
- **Realtime:**
  - Use Ably/Pusher channels with `hellshex:<roomId>` pattern
  - Trigger client state changes only on echoes from realtime bus
- **Composables:**
  - Create under `/app/composables/`
  - Always stateless and reusable; never reference UI only state from composable
- **Secrets & Env:**
  - Never commit `.env` or API keys
  - Reference secrets via runtimeConfig in `nuxt.config.ts`
- **Other:**
  - Ignore `.crush` directory in git

---
This file is used by agentic coding assistants (like Crush or Cursor). Update with any new conventions or scripts as the repo evolves.

# Tutorion

An experiment for turning lecture PDFs, exam sheets, and exercise sets into structured math/science practice. The current prototype ingests PDFs, extracts topics, and produces quiz questions by calling OpenAI models.

## Getting started
1. Create a virtual environment and install dependencies:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. Export your API key:
   ```bash
   export OPENAI_API_KEY=sk-...
   ```

3. Install the Apps SDK dependencies (for the MCP server + web widget):
   ```bash
   npm install
   ```

## Workflow
1. **Extract topics from PDFs** (ordered from foundational to advanced):
   ```bash
   python -m tutorion.app topics path/to/handout.pdf --output output/topics.json
   ```
2. **Generate quiz questions** for the first topic in `topics.json`:
   ```bash
   python -m tutorion.app quiz output/topics.json --output output/quiz.json
   ```

Both commands default to `gpt-5-mini` but you can change the `--model` flag to any compatible model. The `--difficulty` flag on `quiz` lets you request introductory, intermediate, or advanced practice.

> Merge tip: `server.js` now delegates to `mcp/serverFactory.js` (shared with the Vercel function in `api/mcp.js`). If you hit merge conflicts, prefer keeping the factory-based imports and avoid reintroducing the old inline server/tool definitions.

### Server entrypoints to keep
- **Standalone (local):** `server.js` should import from `mcp/serverFactory.js` and expose `/mcp`, `/` (health), and the OAuth metadata route. If you see conflict markers that try to re-add inline tool definitions, discard them in favor of the factory imports.
- **Vercel Function:** `api/mcp.js` uses the same factory via `configureTutorServer`. Keeping both files pointed at the shared factory prevents drift between the local and Vercel MCP paths.

## Notes
- PDF ingestion uses `pypdf` to chunk pages into ~1200-character spans to keep prompts focused.
- Saved topics include short context excerpts to keep quiz generation grounded in the uploaded material.
- This repository aims to align with the [OpenAI Apps SDK](https://developers.openai.com/apps-sdk/quickstart) model-first workflow; a future iteration can wrap these commands as app actions and add user-progress tracking.

## Try the embedded tutor widget
1. Start the MCP server that exposes the widget and stub tools:
   ```bash
   npm start
   ```
   You should see: `Tutorion MCP server listening on http://localhost:8787/mcp`.

2. (Optional) Inspect the server with the MCP Inspector:
   ```bash
   npx @modelcontextprotocol/inspector@latest http://localhost:8787/mcp
   ```

3. To wire it into ChatGPT, expose the server with a tunnel such as ngrok:
   ```bash
   ngrok http 8787
   ```
   Add the public URL suffixed with `/mcp` (e.g., `https://<subdomain>.ngrok.app/mcp`) as a connector in ChatGPT, then open a conversation and pick the Tutorion widget.

The widget supports local previews when `window.openai` is unavailable, but when loaded through ChatGPT it will stay in sync with tool responses via `window.openai.callTool` and `window.openai.toolOutput`.

## Deploying to Vercel

You can now choose either (a) **static widget hosting only** or (b) **full MCP server on Vercel Functions**. Both paths are supported without breaking local `node server.js` usage.

### Option A: Static widget only (MCP hosted elsewhere)
1. Deploy with the included `vercel.json` (publishes everything under `/public` and routes `/` to the widget).
2. Point ChatGPT at your own `/mcp` endpoint (e.g., ngrok, Fly.io, VM). The widget calls that external MCP.

### Option B: MCP server on Vercel Functions
1. The new `api/mcp.js` route wraps the same tools/resources via `mcp-handler`.
2. Deploy normally to Vercel; your MCP endpoint will be `https://<project>.vercel.app/api/mcp`.
3. OAuth resource metadata is served from `https://<project>.vercel.app/.well-known/oauth-protected-resource` (reuses the same env vars as the standalone server).
4. Keep using `npm start` for local testing; the Vercel function path is additive.
5. The Vercel build expects a published `mcp-handler` version; the repo pins `mcp-handler@^1.0.4` (latest npm release).

Pick the path that fits your environment—both deployments share the same widget and tool definitions.

## Enabling OAuth for protected tools
The MCP server now exposes OAuth metadata for ChatGPT so you can gate tool usage behind your identity provider.

1. Configure the resource and authorization servers with environment variables (replace the defaults with your own):
   ```bash
   export MCP_RESOURCE_BASE_URL="https://your-mcp.example.com"
   export MCP_AUTHORIZATION_SERVER="https://auth.yourcompany.com"
   export MCP_SCOPES="materials:read materials:write"
   export MCP_REQUIRE_AUTH=true   # require a Bearer token on /mcp requests
   ```

2. Start the server and verify the protected resource metadata is reachable:
   ```bash
   npm start
   curl https://your-mcp.example.com/.well-known/oauth-protected-resource
   ```

3. When `MCP_REQUIRE_AUTH=true`, unauthenticated calls to `/mcp` return `401` with a `WWW-Authenticate` challenge that points ChatGPT to the metadata URL, prompting the OAuth flow.

4. Each tool advertises `securitySchemes` with both `noauth` and `oauth2` plus your scopes so ChatGPT can render the linking UI and request the right permissions during consent.

After linking, your MCP server should validate access tokens (issuer, audience/resource, expiry, and scopes) according to your IdP's discovery document before executing tools.

## Building and iterating on the MCP server + widget
These notes summarize how to keep the server, widget runtime, and tools aligned with the Apps SDK expectations.

### Core responsibilities
- **MCP server**: register `text/html+skybridge` widget templates, define tools with schemas/metadata, enforce auth, and return `structuredContent` + optional `_meta` for the widget.
- **Widget bundle**: renders inside ChatGPT's iframe, reads `window.openai.toolOutput`/`toolInput`, persists state with `window.openai.setWidgetState`, and may call tools via `window.openai.callTool` when `_meta["openai/widgetAccessible"]` is enabled.
- **Model**: chooses when to call tools using the descriptors you provide; keep tool handlers idempotent because calls may retry.

### Minimal local workflow
1. Build the widget bundle (e.g., `npm run build` if you adopt a bundler) so `public/tutor-widget.html` can inline JS/CSS.
2. Start the MCP server locally (`npm start`), which serves the widget resource and handles `/mcp` requests.
3. Validate end to end with MCP Inspector: `npx @modelcontextprotocol/inspector@latest http://localhost:8787/mcp`.
4. When ready to test in ChatGPT, expose the server via `ngrok http 8787` and register the public `/mcp` URL as a connector.

### Widget runtime essentials
- `window.openai.toolInput` contains the arguments ChatGPT passed to the tool; `toolOutput` mirrors your `structuredContent` response; `_meta` is only visible inside the widget.
- `window.openai.setWidgetState(state)` persists UI state between renders; call it after meaningful user interactions.
- `window.openai.callTool(name, args)` mirrors model-initiated tool calls and keeps the UI in sync when tools mark `openai/widgetAccessible: true`.
- Other helpers (`requestModal`, `notifyIntrinsicHeight`, `openExternal`) are available to adapt layout and interactions to ChatGPT's sandbox.

### Design tips
- Keep `structuredContent` concise because the model reads it verbatim; use `_meta` for widget-only payloads.
- Cache-bust widget template URIs (e.g., `ui://widget/tutor-v2.html`) when you ship breaking UI changes.
- Declare per-tool `securitySchemes` (`noauth` and/or `oauth2`) and emit `WWW-Authenticate` errors with an `error_description` when you need ChatGPT to prompt for OAuth linking.

## MCP server quickstart (reference)
This condensed guide mirrors the Apps SDK “Build your MCP server” flow so you can wire Tutorion (or any widget) to ChatGPT end to end.

### Architecture flow
1. User prompt triggers a model-chosen MCP tool call.
2. The server runs the handler, returns `structuredContent`, `_meta`, and narrative `content`.
3. ChatGPT loads the `text/html+skybridge` template referenced by the tool and injects `window.openai` globals.
4. The widget renders from `window.openai.toolOutput`, persists UI state via `setWidgetState`, and can call tools with `callTool`.
5. The model reads `structuredContent` verbatim, so keep it concise and idempotent.

```
User prompt
   ↓
ChatGPT model ──► MCP tool call ──► Your server ──► Tool response (`structuredContent`, `_meta`, `content`)
   │                                                   │
   └───── renders narration ◄──── widget iframe ◄──────┘
                              (HTML template + `window.openai`)
```

### Widget runtime essentials (`window.openai`)
| Category | Property | Purpose |
| --- | --- | --- |
| State & data | `toolInput` | Arguments supplied when the tool was invoked. |
| State & data | `toolOutput` | Mirrors your `structuredContent`; the model reads it verbatim. |
| State & data | `toolResponseMetadata` | The `_meta` payload visible only inside the widget. |
| State & data | `widgetState` | Snapshot of UI state persisted between renders. |
| State & data | `setWidgetState(state)` | Store a new snapshot after every meaningful interaction. |
| Widget runtime APIs | `callTool(name, args)` | Invoke another MCP tool from the widget. |
| Widget runtime APIs | `sendFollowUpMessage({ prompt })` | Ask ChatGPT to post a widget-authored message. |
| Widget runtime APIs | `requestDisplayMode` | Request PiP/fullscreen modes. |
| Widget runtime APIs | `requestModal` | Open a host-owned modal for detail views. |
| Widget runtime APIs | `notifyIntrinsicHeight` | Report dynamic heights to avoid clipping. |
| Widget runtime APIs | `openExternal({ href })` | Open a vetted external link. |
| Context | `theme`, `displayMode`, `maxHeight`, `safeArea`, `view`, `userAgent`, `locale` | Signals to adapt visuals/copy; subscribe with `useOpenAiGlobal` if using React. |

Use `requestModal` for host-controlled overlays, and remember that `structuredContent` is model-visible while `_meta` is widget-only.

### Server checklist
- **Templates**: Register widget bundles as resources with `mimeType: "text/html+skybridge"` and include `_meta` (borders, CSP, domain, description).
- **Tools**: Provide names, titles, schemas, `_meta["openai/outputTemplate"]`, and optional invoking strings. Keep handlers idempotent.
- **Security**: Add per-tool `securitySchemes` (`noauth`/`oauth2`) and return `WWW-Authenticate` challenges with `error` + `error_description` when auth is required. Expose `/.well-known/oauth-protected-resource` so ChatGPT can start OAuth.
- **Local loop**: Build the widget, run `npm start`, and validate with `npx @modelcontextprotocol/inspector@latest http://localhost:8787/mcp`.
- **Expose HTTPS**: Tunnel with `ngrok http 8787` (or deploy) and provide the public `/mcp` URL when adding the connector in ChatGPT.

## UX principles for the Tutorion app

Design the Tutorion experience so it feels native to ChatGPT and focuses on conversational value rather than porting a full web app.

### Principles for great app UX
- **Conversational leverage**: Make actions easier because they start from natural language and thread context.
- **Native fit**: Keep hand-offs between the model, tools, and widget seamless; prefer structured content plus a concise UI over full-page replicas.
- **Composability**: Shape tools as small, reusable building blocks the model can mix with other apps.
- **Extract, don’t port**: Pick atomic workflows (e.g., “summarize this problem set,” “create practice from these slides”) instead of mirroring every page of a course site.
- **Design for conversational entry**: Handle open-ended prompts, direct commands, and first-run onboarding.
- **Treat ChatGPT as home**: Let the conversation carry history and narration; the widget should clarify actions and capture inputs, not replace the chat.
- **Optimize for conversation, not navigation**: Provide clear, typed tool parameters and concise responses; avoid deep navigation flows.
- **Embrace the ecosystem moment**: Accept rich natural language, personalize with context, and compose with other tools when it helps the learner.

### Checklist before publishing
Answer these yes/no questions; a “no” points to areas to refine before broader distribution:
- Does at least one core capability rely on ChatGPT strengths (conversation, context, multi-turn guidance)?
- Does the app provide knowledge, actions, or presentation users cannot get from plain chat?
- Are tools atomic with explicit inputs/outputs so the model can invoke them without clarifications?
- Would removing the widget and returning only text degrade the experience meaningfully?
- Can users complete at least one meaningful task entirely inside ChatGPT?
- Is performance responsive enough to keep a conversational rhythm?
- Is it easy to imagine prompts where the model would confidently select this app?
- Does the app leverage platform behaviors (multi-tool composition, multimodality, memory, or prior context)?

Avoid long-form/static content better suited for a website, complex multi-step flows that exceed inline/fullscreen modes, ads/irrelevant messaging, or exposing sensitive data in the widget. Do not recreate ChatGPT system functions (e.g., the input composer).

### Example (minimal)
```ts
server.registerResource('hello', 'ui://widget/hello.html', {}, async () => ({
  contents: [
    {
      uri: 'ui://widget/hello.html',
      mimeType: 'text/html+skybridge',
      text: `\n<div id="root"></div>\n<script type="module" src="https://example.com/hello-widget.js"></script>\n`.trim(),
    },
  ],
}));

server.registerTool(
  'hello_widget',
  {
    title: 'Show hello widget',
    inputSchema: { name: { type: 'string' } },
    _meta: { 'openai/outputTemplate': 'ui://widget/hello.html' },
  },
  async ({ name }) => ({
    structuredContent: { message: `Hello ${name}!` },
    content: [{ type: 'text', text: `Greeting ${name}` }],
    _meta: {},
  }),
);
```

For non-React widgets, you can read/write `window.openai.toolOutput` and `window.openai.setWidgetState` directly.

## ChatGPT UI quickstart (reference)
This companion guide summarizes how Tutorion’s widget should interact with ChatGPT’s iframe runtime via `window.openai`.

### `window.openai` essentials
- **Globals**: `toolInput`, `toolOutput`, `toolResponseMetadata`, `widgetState`, `theme`, `displayMode`, `maxHeight`, `safeArea`, `locale`, `userAgent`.
- **APIs**: `callTool(name, args)`, `sendFollowUpMessage({ prompt })`, `requestDisplayMode({ mode })`, `requestModal(...)`, `notifyIntrinsicHeight(...)`, `openExternal({ href })`, `setWidgetState(state)`, `requestClose()`.
- React projects can subscribe to globals with a helper like `useOpenAiGlobal(key)` that listens for `openai:set_globals` events so components stay in sync when ChatGPT updates layout or tool output.

### Persist and expose widget state
- Call `window.openai.setWidgetState(state)` after meaningful interactions; the host hydrates the value into `window.openai.widgetState` on subsequent renders of the same widget instance.
- Keep the payload concise (<4k tokens) because the model can read it; it is scoped to the widget instance, not the entire conversation.

### Trigger server actions and follow-ups
- Component-initiated tool calls require the tool to opt into `_meta["openai/widgetAccessible"]`; then you can use `await window.openai.callTool("refresh_pizza_list", { city })`.
- To send a conversational nudge, call `window.openai.sendFollowUpMessage({ prompt: "Draft a study plan" })`; ChatGPT will post it as a new user turn.

### Layout and lifecycle
- Request alternate layouts when needed: `await window.openai.requestDisplayMode({ mode: "fullscreen" })`; PiP may coerce to fullscreen on mobile.
- Close the widget from the UI with `window.openai.requestClose()` or from the server by returning `metadata["openai/closeWidget"] = true` in a tool response.
- Use host-backed navigation normally (e.g., React Router) to keep the sandbox and ChatGPT history aligned.

### Bundle and embed the widget
1. Author your component (React or vanilla) under `public/` or a `web/` directory and read initial data from `window.openai.toolOutput` or `widgetState`.
2. Bundle the entry file into a single JS module (e.g., `esbuild src/component.tsx --bundle --format=esm --outfile=dist/component.js`).
3. Inline the JS (and CSS) into the `text/html+skybridge` template served by the MCP server so ChatGPT can inject the runtime when the tool’s `_meta["openai/outputTemplate"]` points to that URI.

## Managing state inside ChatGPT widgets
Tutorion follows the Apps SDK state model so data stays authoritative on the server while the widget remains responsive.

| State type | Owned by | Lifetime | Examples |
| --- | --- | --- | --- |
| **Business data (authoritative)** | MCP server or backend | Long-lived | Topics, quizzes, extracted document text |
| **UI state (ephemeral)** | The widget instance | Only for the active widget message | Selected topic, expanded quiz card, current difficulty filter |
| **Cross-session state (durable)** | Backend or external storage | Cross-session/conversation | Saved preferences, recent uploads, pinned courses |

**Key behaviors**
- Widgets are message-scoped; each response that returns a widget spins up a fresh instance with its own UI state.
- UI state sticks to that widget instance and rehydrates when you reopen the same message.
- The server remains the source of truth; widgets reapply their UI state atop the latest `structuredContent` snapshot.

### 1) Keep business data authoritative on the server
- Run mutations through MCP tools; return the updated snapshot in `structuredContent` so the model and widget stay aligned.
- Design handlers to be idempotent—ChatGPT may retry tool calls.

### 2) Store ephemeral UI state with `window.openai`
- Read the current widget state from `window.openai.widgetState` and persist changes with `window.openai.setWidgetState(next)`.
- Treat `setWidgetState` like local state: it is synchronous and scoped to the current widget message; no `await` needed.
- In React, use a helper like `useWidgetState` (built on `useOpenAiGlobal("widgetState")`) to hydrate and persist state.
- Keep payloads concise (<4k tokens) because the model can read widget state.

### 3) Persist cross-session preferences in your backend
- For data that must survive new conversations or devices (e.g., saved filters), call a tool that writes to your backend and returns updated `structuredContent`.
- Pair this with OAuth when user-specific storage is involved so you can associate ChatGPT users with backend records.

### Practical examples
- **React**: call `setWidgetState((prev) => ({ ...prev, selectedTopic: id }))` inside event handlers and re-render from `window.openai.toolOutput` + widget state.
- **Vanilla JS**: mutate a local `widgetState` object, call `window.openai.setWidgetState(widgetState)`, then re-render from the authoritative tasks/topics payload.

### Checklist for Tutorion
- Keep topics/quizzes on the server; do not mirror them into widget state.
- Use widget state only for view concerns (expanded card, selection, sort order).
- When preferences need to persist across sessions, add a tool that stores them server-side and returns the latest snapshot.

## UI guidelines for the Tutorion widget
Design the Tutorion widget so it looks and behaves like a native ChatGPT surface across inline, fullscreen, and PiP modes.

### Display modes
- **Inline card**: use for quick confirmations or small amounts of structured data. Limit to one primary and one secondary action, avoid nested scrolling or deep navigation, and let ChatGPT handle narration beneath the card.
- **Inline carousel**: present 3–8 visually rich items side-by-side. Include imagery, concise titles/metadata, and a single CTA per item when applicable.
- **Fullscreen**: reserve for richer flows (maps, detailed practice sets) that need more space. Assume the ChatGPT composer remains visible; design actions to work conversationally.
- **Picture-in-picture (PiP)**: use for ongoing sessions (e.g., timed quizzes) that should remain visible while the chat continues. Keep controls minimal, ensure it updates in response to chat input, and close automatically when the session ends.

### Visual system
- Prefer the Apps SDK UI kit (or equivalent system styles) for spacing, typography, and components; avoid custom fonts. Use system palettes for text/backgrounds and reserve brand color for accents or primary buttons.
- Maintain consistent padding, grid spacing, and rounded corners; keep text concise with clear hierarchy (title, supporting text, CTA).
- Use monochromatic, outline-friendly icons; supply alt text for imagery and keep aspect ratios intact.
- Meet accessibility expectations (WCAG AA contrast) and provide succinct alt text for all images.

### Interaction rules of thumb
- Avoid duplicating ChatGPT system controls (e.g., composers) or surfacing ads/irrelevant messaging inside the widget.
- Keep actions atomic and model-friendly; avoid deep navigation within a single card. Prefer follow-up tool calls or new cards for additional steps.
- Request alternate layouts via `requestDisplayMode` when the experience needs more space; otherwise let the inline card auto-fit without internal scrollbars.

### Pre-publish sanity checks
- Does replacing the widget with plain text meaningfully degrade the experience?
- Are primary actions clear, limited, and conversationally framed?
- Would a user understand the card or carousel at a glance on mobile?

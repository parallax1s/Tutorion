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

Both commands default to `gpt-4.1-mini` but you can change the `--model` flag to any compatible model. The `--difficulty` flag on `quiz` lets you request introductory, intermediate, or advanced practice.

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

## Deploying the widget to Vercel
Vercel can host the static widget, but the MCP server should run elsewhere (e.g., a small VM, Fly.io, or a tunnel like ngrok) because it needs a long-lived `/mcp` endpoint with streaming responses.

1. Add the included `vercel.json` to your project root (it tells Vercel to publish everything under `/public` as static files and route `/` to the widget).
2. Push the repo to GitHub and create a new Vercel project pointing at this repository.
3. When prompted for the root directory, keep it at `/` (the config handles the static output).
4. Deploy. Vercel will serve the widget at the project URL (e.g., `https://<project>.vercel.app/`).

To use the widget with ChatGPT, point ChatGPT at your MCP server's public `/mcp` URL (from ngrok or your host). The widget will render inside ChatGPT using `window.openai.callTool` to reach that MCP server.

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

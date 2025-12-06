# Agent Guidelines for Tutorion

These instructions apply to the entire repository.

## Apps SDK alignment
- Design features assuming the app will run inside ChatGPT via the Apps SDK and MCP. Every iteration should keep both pieces in mind:
  - A web component (rendered in an iframe by ChatGPT) that uses `window.openai.callTool`/`window.openai.toolOutput` to stay in sync.
  - An MCP server exposing tools and UI resources at `/mcp`, with appropriate CORS headers and a health check on `/`.
- When adding a UI, bundle it as static HTML (or the build output of your framework) and register it as an Apps SDK resource. Prefer a single HTML entry point that inlines the required assets for easy embedding.
- Tools should return both textual content and `structuredContent` so the frontend can render fresh state without extra prompts. Favor `structuredContent` keys that mirror the UI data model.

## MCP server expectations
- Expose `/mcp` with support for POST/GET/DELETE and CORS preflight. Include a simple 200 OK response on `/` for health checks and 404s for unused OAuth discovery routes to avoid noisy 502s during setup.
- Keep the server stateless unless you intentionally manage sessions; `StreamableHTTPServerTransport` in stateless mode is acceptable for quickstarts.
- Use ES modules in Node examples (`"type": "module"` in `package.json`). If you add TypeScript, ensure the compiled output is what the server serves.

## Local development and testing
- Provide clear run instructions in docs or code comments (e.g., `node server.js` or `npm run build && node server.js`).
- When applicable, mention how to expose the server publicly for ChatGPT testing (e.g., `ngrok http <port>`), and how to validate with `npx @modelcontextprotocol/inspector@latest <url>`.

## Style and safety
- Keep UI styling minimal and self-contained (embedded CSS) to avoid cross-context surprises in the iframe.
- Avoid wrapping imports in try/catch. Surface errors explicitly in tool responses or server logs.

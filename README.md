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

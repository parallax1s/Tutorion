import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const MCP_RESOURCE_BASE_URL =
  process.env.MCP_RESOURCE_BASE_URL || 'https://example.tutorion.app';
export const MCP_AUTHORIZATION_SERVER =
  process.env.MCP_AUTHORIZATION_SERVER || 'https://auth.example.com';
export const MCP_SCOPES = (process.env.MCP_SCOPES || 'materials:read materials:write')
  .split(/\s+/)
  .filter(Boolean);
export const MCP_REQUIRE_AUTH = process.env.MCP_REQUIRE_AUTH === 'true';
export const MCP_PATH = '/mcp';
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource';

const loadWidgetHtml = () => {
  const defaultWidgetHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tutorion widget missing</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; }
      main { max-width: 720px; margin: 0 auto; }
      h1 { font-size: 1.2rem; margin-bottom: 0.5rem; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Tutor widget unavailable</h1>
      <p>The expected <code>public/tutor-widget.html</code> file could not be loaded. Please redeploy with the widget asset bundled.</p>
    </main>
  </body>
</html>`;

  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.join(process.cwd(), 'public', 'tutor-widget.html'),
    path.join(moduleDir, '..', 'public', 'tutor-widget.html'),
  ];

  for (const candidate of candidatePaths) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      console.error(`Failed to load tutor widget from ${candidate}:`, error);
      return defaultWidgetHtml;
    }
  }

  console.warn('Tutor widget HTML missing; using inline fallback.');
  return defaultWidgetHtml;
};

const widgetHtml = loadWidgetHtml();

export const resourceMetadata = () => ({
  resource: MCP_RESOURCE_BASE_URL,
  authorization_servers: [MCP_AUTHORIZATION_SERVER],
  scopes_supported: MCP_SCOPES,
  resource_documentation: 'https://example.tutorion.app/docs/mcp',
});

export const buildWwwAuthenticate = (scope) =>
  `Bearer resource_metadata="${MCP_RESOURCE_BASE_URL}${RESOURCE_METADATA_PATH}", scope="${scope}"`;

const ingestSchema = {
  title: z.string().min(1, 'Title is required'),
  text: z.string().min(40, 'Please provide at least a few sentences'),
};

const generateQuizSchema = {
  topicId: z.string().min(1, 'Topic id is required'),
  difficulty: z.enum(['intro', 'intermediate', 'advanced']).default('intro'),
};

const configureStatefulHandlers = (server) => {
  let materials = [];
  let topics = [];
  let quiz = null;
  let nextId = 1;

  const resetQuizIfMissingTopic = () => {
    if (quiz && !topics.find((t) => t.id === quiz.topicId)) {
      quiz = null;
    }
  };

  const tokenizeSentences = (text) =>
    text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 30);

  const extractMathSignals = (sentences) => {
    const mathKeywords = [
      'markov',
      'transition',
      'probability',
      'rate',
      'matrix',
      'generator',
      'master equation',
      'steady state',
      'stationary',
      'chain',
      'state space',
      'stochastic',
      'derivative',
      'differential',
      'ode',
      'expectation',
      'variance',
      'drift',
    ];

    const formulaRegex = /[=∝≈]|\\(frac|sum|int|partial|nabla|pi|lambda|mu|sigma|theta)/i;

    return sentences
      .map((sentence, index) => {
        const lower = sentence.toLowerCase();
        const keywordScore = mathKeywords.reduce(
          (score, keyword) => (lower.includes(keyword) ? score + 1 : score),
          0,
        );
        const hasFormula = formulaRegex.test(sentence);
        const score = keywordScore * 2 + (hasFormula ? 3 : 0) + Math.max(0, 2 - index);
        return { sentence, keywordScore, hasFormula, score };
      })
      .filter((entry) => entry.keywordScore > 0 || entry.hasFormula)
      .sort((a, b) => b.score - a.score);
  };

  const deriveTopicsFromMaterial = (material) => {
    const sentences = tokenizeSentences(material.text);
    const ranked = extractMathSignals(sentences);
    const chosen = ranked.length ? ranked.slice(0, 4) : sentences.slice(0, 3).map((sentence) => ({ sentence }));

    if (!chosen.length) {
      return [
        {
          id: `topic-${nextId++}`,
          title: `${material.title} overview`,
          rationale: 'High-level summary of the uploaded material.',
          sourceTitle: material.title,
          highlights: [],
        },
      ];
    }

    return chosen.map((entry, index) => ({
      id: `topic-${nextId++}`,
      title: `${material.title} – Concept ${index + 1}`,
      rationale: entry.sentence ?? 'Core step from the material.',
      sourceTitle: material.title,
      highlights: sentences.slice(index, index + 2),
      hasFormula: Boolean(entry.hasFormula),
    }));
  };

  const buildQuizForTopic = (topic, difficulty) => {
    const fallback = 'Summarize the governing idea and show how it applies to a concrete step.';
    const rationale = topic.rationale || fallback;
    const highlight = topic.highlights?.[0] || fallback;

    const questions = [
      {
        id: `q-${topic.id}-concept`,
        prompt: `State the core idea of “${topic.title}” in your own words. Why does it matter?`,
        answer: rationale,
        difficulty,
      },
      {
        id: `q-${topic.id}-equation`,
        prompt: topic.hasFormula
          ? 'Write the key equation or transition rule and explain each term.'
          : 'Describe the update rule or probability flow that defines the process.',
        answer: topic.hasFormula
          ? `Use the expression mentioned in the notes: ${highlight}`
          : highlight,
        difficulty,
      },
      {
        id: `q-${topic.id}-link`,
        prompt:
          'Connect this topic to a prerequisite (e.g., Markov property, normalization, or steady-state condition).',
        answer: 'Relate the transition probabilities to conservation of probability and the Markov memoryless property.',
        difficulty,
      },
    ];

    return { topicId: topic.id, difficulty, questions };
  };

  const structuredState = (message) => ({
    message,
    materials,
    topics,
    quiz,
  });

  server.registerTool(
    'ingest_material',
    {
      title: 'Add study material',
      description: 'Store pasted lecture text or extracted PDF content.',
      inputSchema: ingestSchema,
      securitySchemes: [
        { type: 'noauth' },
        { type: 'oauth2', scopes: MCP_SCOPES },
      ],
      _meta: {
        'openai/outputTemplate': 'ui://widget/tutor.html',
        'openai/toolInvocation/invoking': 'Uploading material',
        'openai/toolInvocation/invoked': 'Material uploaded',
        'openai/widgetAccessible': true,
      },
    },
    async (args) => {
      const titleInput = args?.title?.trim?.() ?? '';
      const text = args?.text?.trim?.() ?? '';
      if (!text) {
        return {
          content: [{ type: 'text', text: 'Missing text. Provide notes or ask ChatGPT to pass the PDF extract.' }],
          structuredContent: structuredState('Missing text input'),
        };
      }
      const title = titleInput || `Material ${materials.length + 1}`;
      const material = { id: `material-${nextId++}`, title, text, characters: text.length };
      materials = [...materials, material];
      return {
        content: [{ type: 'text', text: `Stored “${title}”.` }],
        structuredContent: structuredState('Material captured'),
      };
    },
  );

  server.registerTool(
    'extract_topics',
    {
      title: 'Extract topics',
      description: 'Break materials into ordered topics for practice.',
      inputSchema: {},
      securitySchemes: [
        { type: 'noauth' },
        { type: 'oauth2', scopes: MCP_SCOPES },
      ],
      _meta: {
        'openai/outputTemplate': 'ui://widget/tutor.html',
        'openai/toolInvocation/invoking': 'Extracting topics',
        'openai/toolInvocation/invoked': 'Topics ready',
        'openai/widgetAccessible': true,
      },
    },
    async () => {
      topics = materials.flatMap(deriveTopicsFromMaterial);
      resetQuizIfMissingTopic();
      return {
        content: [{ type: 'text', text: `Generated ${topics.length} topic(s).` }],
        structuredContent: structuredState('Topics generated'),
      };
    },
  );

  server.registerTool(
    'generate_quiz',
    {
      title: 'Generate quiz',
      description: 'Create quiz questions for a topic id.',
      inputSchema: generateQuizSchema,
      securitySchemes: [
        { type: 'noauth' },
        { type: 'oauth2', scopes: MCP_SCOPES },
      ],
      _meta: {
        'openai/outputTemplate': 'ui://widget/tutor.html',
        'openai/toolInvocation/invoking': 'Assembling quiz',
        'openai/toolInvocation/invoked': 'Quiz ready',
        'openai/widgetAccessible': true,
      },
    },
    async (args) => {
      const topicId = args?.topicId;
      const difficulty = args?.difficulty ?? 'intro';
      const topic = topics.find((entry) => entry.id === topicId);
      if (!topic) {
        return {
          content: [{ type: 'text', text: 'Topic not found. Generate topics first.' }],
          structuredContent: structuredState('Topic missing'),
        };
      }
      quiz = buildQuizForTopic(topic, difficulty);
      return {
        content: [{ type: 'text', text: `Quiz prepared for ${topic.title}.` }],
        structuredContent: structuredState('Quiz ready'),
      };
    },
  );
};

export function configureTutorServer(server) {
  server.registerResource(
    'tutor-widget',
    'ui://widget/tutor.html',
    {},
    async () => ({
      contents: [
        {
          uri: 'ui://widget/tutor.html',
          mimeType: 'text/html+skybridge',
          text: widgetHtml,
          _meta: {
            'openai/widgetPrefersBorder': true,
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: ['https://*.oaistatic.com'],
            },
            'openai/widgetDescription':
              'Tutorion ingests math/science materials and generates practice quizzes.',
          },
        },
      ],
    }),
  );

  configureStatefulHandlers(server);

  return server;
}

export function createTutorServer() {
  const server = new McpServer({ name: 'tutorion', version: '0.2.0' });
  return configureTutorServer(server);
}

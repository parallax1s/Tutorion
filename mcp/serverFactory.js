import { readFileSync } from 'node:fs';
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

const widgetHtml = readFileSync('public/tutor-widget.html', 'utf8');

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

  const deriveTopicsFromMaterial = (material) => {
    const sentences = material.text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20)
      .slice(0, 4);

    if (!sentences.length) {
      return [
        {
          id: `topic-${nextId++}`,
          title: `${material.title} overview`,
          rationale: 'High-level summary of the uploaded material.',
          sourceTitle: material.title,
        },
      ];
    }

    return sentences.map((sentence, index) => ({
      id: `topic-${nextId++}`,
      title: `${material.title} – Concept ${index + 1}`,
      rationale: sentence,
      sourceTitle: material.title,
    }));
  };

  const buildQuizForTopic = (topic, difficulty) => {
    const prompts = [
      `Explain the first principle behind ${topic.title}.`,
      `Show a worked example related to ${topic.title}.`,
      `How does ${topic.title} connect to a prerequisite concept?`,
    ];

    return {
      topicId: topic.id,
      questions: prompts.map((prompt, index) => ({
        id: `q-${nextId++}`,
        prompt,
        answer:
          index === 1
            ? 'Start from the given definition and solve step-by-step to the final expression.'
            : 'Highlight assumptions and the key step that changes the outcome.',
        difficulty,
      })),
    };
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
      const title = args?.title?.trim?.() ?? '';
      const text = args?.text?.trim?.() ?? '';
      if (!title || !text) {
        return {
          content: [{ type: 'text', text: 'Missing title or text.' }],
          structuredContent: structuredState('Missing inputs'),
        };
      }
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

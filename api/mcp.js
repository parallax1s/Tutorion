import { createMcpHandler } from 'mcp-handler';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { configureTutorServer } from '../mcp/serverFactory.js';

const handler = createMcpHandler(
  (server) => {
    configureTutorServer(server);
  },
  {
    transportFactory: () =>
      new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      }),
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'mcp-session-id'],
      exposedHeaders: ['Mcp-Session-Id'],
    },
  },
  { basePath: '/api' },
);

export { handler as GET, handler as POST, handler as DELETE };

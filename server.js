import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
// Server wiring lives in mcp/serverFactory so both this standalone entrypoint
// and the Vercel function (api/mcp.js) stay in sync.
import {
  MCP_PATH,
  MCP_REQUIRE_AUTH,
  MCP_SCOPES,
  RESOURCE_METADATA_PATH,
  buildWwwAuthenticate,
  createTutorServer,
  resourceMetadata,
} from './mcp/serverFactory.js';

const port = Number(process.env.PORT ?? 8787);

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400).end('Missing URL');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === RESOURCE_METADATA_PATH) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(resourceMetadata()));
    return;
  }

  if (req.method === 'OPTIONS' && url.pathname === MCP_PATH) {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, mcp-session-id',
      'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Tutorion MCP server');
    return;
  }

  const MCP_METHODS = new Set(['POST', 'GET', 'DELETE']);
  if (url.pathname === MCP_PATH && req.method && MCP_METHODS.has(req.method)) {
    if (MCP_REQUIRE_AUTH) {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
        res.writeHead(401, {
          'WWW-Authenticate': buildWwwAuthenticate(MCP_SCOPES[0] || 'materials:read'),
          'content-type': 'application/json',
        });
        res.end(
          JSON.stringify({
            error: 'missing_token',
            error_description: 'Authentication required: no access token provided.',
          }),
        );
        return;
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    const server = createTutorServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.writeHead(500).end('Internal server error');
      }
    }
    return;
  }

  res.writeHead(404).end('Not Found');
});

httpServer.listen(port, () => {
  console.log(`Tutorion MCP server listening on http://localhost:${port}${MCP_PATH}`);
});

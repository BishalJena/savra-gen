// Fastify API server entrypoint
import './load-env';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pptRoutes } from './routes/ppt';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  const app = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });

  // CORS for frontend
  await app.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  });

  // Health check
  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'savra-ppt-api',
    timestamp: new Date().toISOString(),
  }));

  // PPT generation routes
  await app.register(pptRoutes);

  // Start server
  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`\n🚀 Savra PPT API running at http://localhost:${PORT}`);
    console.log(`   Health:   http://localhost:${PORT}/api/health`);
    console.log(`   Stats:    http://localhost:${PORT}/api/ppt/stats`);
    console.log(`   Generate: POST http://localhost:${PORT}/api/ppt/generate\n`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();

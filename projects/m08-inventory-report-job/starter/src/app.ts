import Fastify, { type FastifyInstance } from 'fastify';
import { registerInventoryRoutes } from './routes/inventory.js';
import { registerReportRoutes } from './routes/reports.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ status: 'ok' }));
  app.register(registerInventoryRoutes);
  app.register(registerReportRoutes);
  return app;
}

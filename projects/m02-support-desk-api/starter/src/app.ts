import Fastify, { type FastifyInstance } from 'fastify';
import { registerTicketRoutes } from './routes/tickets.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  app.register(registerTicketRoutes);

  return app;
}

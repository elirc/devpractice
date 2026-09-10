import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3102);
const app = buildApp();

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => console.log('Support desk API listening on http://localhost:' + port))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

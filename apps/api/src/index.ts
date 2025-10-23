import { loadAppEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createServer } from './server.js';

const env = loadAppEnv();
const logger = createLogger(env);
const app = createServer({ env, logger });

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server started');
});

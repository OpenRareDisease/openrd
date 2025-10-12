import { loadAppEnv } from './config/env';
import { createLogger } from './config/logger';
import { createServer } from './server';

const env = loadAppEnv();
const logger = createLogger(env);
const app = createServer({ env, logger });

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'API server started');
});

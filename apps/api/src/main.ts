import { createApi } from './app';
import { loadConfig } from './config';
import { defaultInterviewerFactory, defaultKeyVerifier } from './interviewer/wiring';
import { createLogger } from './log';

const config = loadConfig();
const log = createLogger(config.logLevel, config.env === 'development' && process.stdout.isTTY);
const api = await createApi({
  config,
  log,
  interviewerFactory: defaultInterviewerFactory(config),
  verifyAiKey: defaultKeyVerifier(config),
});
const port = await api.listen();
log.info(
  {
    port,
    webOrigin: config.webOrigin,
    // Runs only on keys users save themselves; there is no operator key.
    interviewer: `user keys (Anthropic default ${config.interviewerModel}, unused keys expire after ${config.aiKeyTtlHours} h)`,
    githubAuth: config.github !== null,
    googleAuth: config.google !== null,
  },
  'api listening',
);

let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return;
  stopping = true;
  log.info({ signal }, 'shutting down');
  const hard = setTimeout(() => process.exit(1), 15_000);
  hard.unref();
  api
    .stop()
    .then(() => process.exit(0))
    .catch((err) => {
      log.error({ err }, 'shutdown failed');
      process.exit(1);
    });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));

import pino, { type DestinationStream, type Logger } from 'pino';

/** Structured logs. Secrets, cookies and bodies are never logged; redaction is a backstop. */
export function createLogger(
  level: string,
  pretty = false,
  destination?: DestinationStream,
): Logger {
  const options: pino.LoggerOptions = {
    level,
    base: { service: 'api' },
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'headers.cookie',
        'headers.authorization',
        'apiKey',
        '*.apiKey',
        '*.aiKeySecret',
        '*.authSecret',
        '*.password',
        '*.token',
        '*.ticket',
        '*.source',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
      : {}),
  };
  return destination ? pino(options, destination) : pino(options);
}

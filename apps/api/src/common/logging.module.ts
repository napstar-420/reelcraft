import { Module, type LoggerService } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { IncomingMessage } from 'node:http';
import { EngineConfig } from '../config/engine-config';

// Inngest step calls, long-lived SSE streams and presigned-blob redirects
// would drown the access log.
const QUIET_PATHS = [
  /^\/api\/inngest(\/|\?|$)/,
  /^\/api\/runs\/[^/]+\/events(\?|$)/,
  /^\/api\/blobs\//,
];

export function isQuietRequest(url: string | undefined): boolean {
  return QUIET_PATHS.some((pattern) => pattern.test(url ?? ''));
}

export function accessLogLevel(statusCode: number, err?: Error): 'info' | 'warn' | 'error' {
  if (err || statusCode >= 500) return 'error';
  return statusCode >= 400 ? 'warn' : 'info';
}

/** Structured logging via pino. Level comes from LOG_LEVEL (default info,
 * warn under test). One access line per request (minus QUIET_PATHS) with
 * status and responseTime; every log line written while serving a request
 * carries that request's id/method/url. */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [EngineConfig],
      useFactory: (config: EngineConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          autoLogging: { ignore: (req: IncomingMessage) => isQuietRequest(req.url) },
          customLogLevel: (_req, res, err) => accessLogLevel(res.statusCode, err),
          quietReqLogger: true,
          serializers: {
            req: (req: IncomingMessage & { id?: unknown }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              '*.apiKey',
              '*.api_key',
              '*.token',
              '*.secret',
              '*.password',
            ],
            censor: '[REDACTED]',
          },
          ...(config.nodeEnv === 'development' && {
            transport: {
              target: 'pino-pretty',
              options: {
                singleLine: true,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            },
          }),
        },
      }),
    }),
  ],
})
export class LoggingModule {}

// Nest logs every module init and route mapping at info on boot; that's
// framework noise, so it's demoted to debug. "NestApplication" (the one
// "successfully started" line) stays at info.
const FRAMEWORK_BOOT_CONTEXTS = new Set([
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
]);

export function withQuietFrameworkBoot(logger: LoggerService): LoggerService {
  return {
    log: (message: unknown, ...params: unknown[]) => {
      const context = params.at(-1);
      if (typeof context === 'string' && FRAMEWORK_BOOT_CONTEXTS.has(context)) {
        logger.debug?.(message, ...params);
      } else {
        logger.log(message, ...params);
      }
    },
    error: (message: unknown, ...params: unknown[]) => logger.error(message, ...params),
    warn: (message: unknown, ...params: unknown[]) => logger.warn(message, ...params),
    debug: (message: unknown, ...params: unknown[]) => logger.debug?.(message, ...params),
    verbose: (message: unknown, ...params: unknown[]) => logger.verbose?.(message, ...params),
    fatal: (message: unknown, ...params: unknown[]) => logger.fatal?.(message, ...params),
  };
}

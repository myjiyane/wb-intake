export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogMeta = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const envLevel = (import.meta.env.VITE_LOG_LEVEL || (import.meta.env.DEV ? 'debug' : 'info')).toLowerCase() as LogLevel;
const threshold = LEVELS[envLevel] ?? LEVELS.info;

const fallbackSessionId = () => Math.random().toString(36).slice(2, 10);

const sessionId = (() => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch (_error) {
      void _error;
      return fallbackSessionId();
    }
  }
  return fallbackSessionId();
})();

function sanitizeMeta(meta?: LogMeta): LogMeta | undefined {
  if (!meta) return undefined;
  const out: LogMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Error) {
      out[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === 'object') {
      try {
        out[key] = JSON.parse(JSON.stringify(value));
      } catch (_error) {
        void _error;
        out[key] = String(value);
      }
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function mergeMeta(...metas: (LogMeta | undefined)[]): LogMeta | undefined {
  const result: LogMeta = {};
  for (const meta of metas) {
    const sanitized = sanitizeMeta(meta);
    if (sanitized) Object.assign(result, sanitized);
  }
  return Object.keys(result).length ? result : undefined;
}

function consoleFor(level: LogLevel) {
  switch (level) {
    case 'error':
      return console.error;
    case 'warn':
      return console.warn;
    case 'debug':
      return console.debug ?? console.log;
    default:
      return console.info ?? console.log;
  }
}

function emit(level: LogLevel, message: string, meta?: LogMeta) {
  if (LEVELS[level] > threshold) return;
  const ts = new Date().toISOString();
  const payload = mergeMeta({ sessionId }, meta);
  const line = `${ts} [${level.toUpperCase()}] ${message}`;
  const writer = consoleFor(level).bind(console);
  if (payload) writer(line, payload);
  else writer(line);
}

function createLogger(baseMeta?: LogMeta) {
  return {
    debug(message: string, meta?: LogMeta) {
      emit('debug', message, mergeMeta(baseMeta, meta));
    },
    info(message: string, meta?: LogMeta) {
      emit('info', message, mergeMeta(baseMeta, meta));
    },
    warn(message: string, meta?: LogMeta) {
      emit('warn', message, mergeMeta(baseMeta, meta));
    },
    error(message: string, meta?: LogMeta) {
      emit('error', message, mergeMeta(baseMeta, meta));
    },
  };
}

const rootLogger = createLogger();

export const logger = {
  debug: rootLogger.debug,
  info: rootLogger.info,
  warn: rootLogger.warn,
  error: rootLogger.error,
  withContext(meta: LogMeta) {
    return createLogger(mergeMeta(meta));
  },
  sessionId,
};

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === 'object' && error) return error;
  return { message: String(error) };
}



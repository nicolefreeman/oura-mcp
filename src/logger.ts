import fs from 'fs';

const DEBUG = process.env.DEBUG === 'true';
const LOG_FILE = process.env.LOG_FILE;

// Redact sensitive fields before logging
const redact = (data: unknown): unknown => {
  if (data === null || data === undefined) return data;
  if (typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map(redact);

  const obj = data as Record<string, unknown>;
  const sensitiveKeys = ['access_token', 'refresh_token', 'client_secret'];
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = sensitiveKeys.includes(key) ? '[REDACTED]' : redact(value);
  }
  return result;
};

const write = (level: string, message: string, data?: unknown): void => {
  if (!DEBUG) return;

  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(redact(data))}` : '';
  const line = `[${timestamp}] [${level}] ${message}${dataStr}\n`;

  process.stderr.write(line);

  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, line);
    } catch {
      // Silently ignore file write errors — never crash the server over logging
    }
  }
};

export const logger = {
  debug(message: string, data?: unknown): void {
    write('DEBUG', message, data);
  },
  error(message: string, error?: unknown): void {
    write('ERROR', message, error);
  },
};

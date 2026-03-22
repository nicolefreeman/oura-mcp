import { jest } from '@jest/globals';
import fs from 'fs';

// logger reads process.env.DEBUG at module load time, so we need
// jest.resetModules() + dynamic import to get an instance with DEBUG=true.

describe('logger – debug disabled (default)', () => {
  it('does not throw when debug/error are called with DEBUG=false', async () => {
    const { logger } = await import('../logger.js');
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.error('test', new Error('boom'))).not.toThrow();
  });
});

describe('logger – debug enabled', () => {
  let debugLogger: { debug: (msg: string, data?: unknown) => void; error: (msg: string, err?: unknown) => void };

  beforeAll(async () => {
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    jest.spyOn(fs, 'appendFileSync').mockReturnValue(undefined);
    process.env.DEBUG = 'true';
    process.env.LOG_FILE = '/tmp/test-oura-mcp.log';
    jest.resetModules();
    const mod = await import('../logger.js?t=debug' as string);
    debugLogger = (mod as { logger: typeof debugLogger }).logger;
  });

  afterAll(() => {
    delete process.env.DEBUG;
    delete process.env.LOG_FILE;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('writes to stderr on debug()', () => {
    debugLogger.debug('hello world');
    expect(process.stderr.write).toHaveBeenCalled();
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('[DEBUG]');
    expect(written).toContain('hello world');
  });

  it('writes to stderr on error()', () => {
    debugLogger.error('something went wrong', new Error('boom'));
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('[ERROR]');
    expect(written).toContain('something went wrong');
  });

  it('appends to log file when LOG_FILE is set', () => {
    debugLogger.debug('file log test');
    expect(fs.appendFileSync).toHaveBeenCalledWith('/tmp/test-oura-mcp.log', expect.any(String));
  });

  it('silently ignores appendFileSync errors', () => {
    (fs.appendFileSync as jest.MockedFunction<typeof fs.appendFileSync>)
      .mockImplementationOnce(() => { throw new Error('Disk full'); });
    expect(() => debugLogger.debug('no crash')).not.toThrow();
  });

  it('omits data section when no data argument is passed', () => {
    debugLogger.debug('no data message');
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('no data message\n');
  });

  it('includes JSON data when data argument is passed', () => {
    debugLogger.debug('with data', { count: 3 });
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('"count":3');
  });

  it('redacts sensitive keys in data objects', () => {
    debugLogger.debug('auth', { access_token: 'my-tok-xyz', refresh_token: 'ref-tok-xyz', client_secret: 'shhh-xyz', other: 'ok' });
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('[REDACTED]');
    // Actual secret values should not appear
    expect(written).not.toContain('my-tok-xyz');
    expect(written).not.toContain('ref-tok-xyz');
    expect(written).not.toContain('shhh-xyz');
    expect(written).toContain('"other":"ok"');
  });

  it('redacts sensitive keys nested inside objects', () => {
    debugLogger.debug('nested', { outer: { access_token: 'nested-secret' } });
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('[REDACTED]');
    expect(written).not.toContain('nested-secret');
  });

  it('handles null data without throwing', () => {
    debugLogger.debug('null data', null);
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('null');
  });

  it('handles primitive data (string)', () => {
    debugLogger.debug('primitive', 'just a string');
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('just a string');
  });

  it('handles array data and redacts sensitive keys within array elements', () => {
    debugLogger.debug('array', [{ access_token: 'arr-secret' }, { safe: 'value' }]);
    const written = (process.stderr.write as jest.Mock).mock.calls.at(-1)?.[0] as string;
    expect(written).toContain('[REDACTED]');
    expect(written).toContain('"safe":"value"');
  });
});

describe('logger – debug enabled without LOG_FILE', () => {
  let noFileLogger: { debug: (msg: string) => void };

  beforeAll(async () => {
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    jest.spyOn(fs, 'appendFileSync').mockReturnValue(undefined);
    process.env.DEBUG = 'true';
    delete process.env.LOG_FILE;
    jest.resetModules();
    const mod = await import('../logger.js?t=nofile' as string);
    noFileLogger = (mod as { logger: typeof noFileLogger }).logger;
  });

  afterAll(() => {
    delete process.env.DEBUG;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('does not call appendFileSync when LOG_FILE is not set', () => {
    noFileLogger.debug('no file');
    expect(fs.appendFileSync).not.toHaveBeenCalled();
  });
});

import { jest } from '@jest/globals';
import { OuraClient } from '../oura-client.js';
import {
  OuraAuthError,
  OuraForbiddenError,
  OuraNotFoundError,
  OuraValidationError,
  OuraAppUpdateError,
  OuraRateLimitError,
  OuraServerError,
} from '../types.js';
import type { TokenManager } from '../token-manager.js';

const mockTokenManager: TokenManager = {
  getValidToken: jest.fn().mockResolvedValue('test-token'),
} as unknown as TokenManager;

function makeResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('OuraClient.get', () => {
  let client: OuraClient;

  beforeEach(() => {
    client = new OuraClient(mockTokenManager);
    jest.clearAllMocks();
    (mockTokenManager.getValidToken as jest.Mock).mockResolvedValue('test-token');
  });

  it('sends request with Authorization header and returns parsed JSON', async () => {
    const body = { id: '1', age: 30 };
    global.fetch = jest.fn().mockResolvedValue(makeResponse(200, body));

    const result = await client.get('/v2/usercollection/personal_info');
    expect(result).toEqual(body);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v2/usercollection/personal_info'),
      expect.objectContaining({ headers: { Authorization: 'Bearer test-token' } })
    );
  });

  it('appends query params to URL', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(200, {}));
    await client.get('/v2/usercollection/sleep', { start_date: '2025-01-01', end_date: '2025-01-07' });
    const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('start_date=2025-01-01');
    expect(calledUrl).toContain('end_date=2025-01-07');
  });

  it('throws OuraServerError on network failure (Error instance)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));
    await expect(client.get('/v2/usercollection/personal_info')).rejects.toThrow(OuraServerError);
  });

  it('throws OuraServerError on network failure (non-Error thrown)', async () => {
    global.fetch = jest.fn().mockRejectedValue('connection refused');
    await expect(client.get('/v2/usercollection/personal_info')).rejects.toThrow(OuraServerError);
  });

  it('throws OuraAuthError on 401', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(401));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraAuthError);
  });

  it('throws OuraForbiddenError on 403', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(403));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraForbiddenError);
  });

  it('throws OuraNotFoundError on 404', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(404));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraNotFoundError);
  });

  it('throws OuraValidationError on 422', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(422));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraValidationError);
  });

  it('throws OuraAppUpdateError on 426', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(426));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraAppUpdateError);
  });

  it('throws OuraRateLimitError on 429', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(429));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraRateLimitError);
  });

  it('throws OuraServerError on 500', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(500));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraServerError);
  });

  it('throws OuraServerError on other 5xx', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(503));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraServerError);
  });

  it('throws OuraServerError on unexpected 4xx', async () => {
    global.fetch = jest.fn().mockResolvedValue(makeResponse(418));
    await expect(client.get('/v2/test')).rejects.toThrow(OuraServerError);
  });
});

describe('OuraClient.getPaginated', () => {
  let client: OuraClient;

  beforeEach(() => {
    client = new OuraClient(mockTokenManager);
    (mockTokenManager.getValidToken as jest.Mock).mockResolvedValue('test-token');
  });

  it('returns all items from a single page response', async () => {
    const items = [{ id: '1' }, { id: '2' }];
    global.fetch = jest.fn().mockResolvedValue(
      makeResponse(200, { data: items })
    );

    const result = await client.getPaginated('/v2/usercollection/sleep', { start_date: '2025-01-01', end_date: '2025-01-07' });
    expect(result).toEqual(items);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('follows next_token to fetch multiple pages', async () => {
    const page1 = { data: [{ id: '1' }], next_token: 'cursor-abc' };
    const page2 = { data: [{ id: '2' }] };

    global.fetch = jest.fn()
      .mockResolvedValueOnce(makeResponse(200, page1))
      .mockResolvedValueOnce(makeResponse(200, page2));

    const result = await client.getPaginated('/v2/usercollection/sleep', { start_date: '2025-01-01', end_date: '2025-01-14' });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: '1' });
    expect(result[1]).toEqual({ id: '2' });
    // Second call should include next_token
    const secondCallUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('next_token=cursor-abc');
  });

  it('respects maxPages limit', async () => {
    // Always returns a next_token so pagination would continue forever without the limit
    const page = { data: [{ id: '1' }], next_token: 'cursor' };
    global.fetch = jest.fn().mockResolvedValue(makeResponse(200, page));

    await client.getPaginated('/v2/usercollection/sleep', { start_date: '2025-01-01', end_date: '2025-01-07' }, 3);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

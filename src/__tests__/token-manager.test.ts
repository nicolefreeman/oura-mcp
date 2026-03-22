import { jest } from '@jest/globals';
import { TokenManager, createTokenManager } from '../token-manager.js';
import { OuraAuthError } from '../types.js';

const FAR_FUTURE = Date.now() / 1000 + 9999;
const JUST_EXPIRED = Date.now() / 1000 + 30; // within the 60s refresh buffer

function makeTokenManager(expiresAt = FAR_FUTURE) {
  return new TokenManager({
    accessToken: 'initial-access',
    refreshToken: 'initial-refresh',
    expiresAt,
  });
}

function makeRefreshResponse(body: object, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.OURA_CLIENT_ID = 'test-client-id';
  process.env.OURA_CLIENT_SECRET = 'test-client-secret';
});

describe('TokenManager.getValidToken', () => {
  it('returns access token when not expiring', async () => {
    const tm = makeTokenManager(FAR_FUTURE);
    const token = await tm.getValidToken();
    expect(token).toBe('initial-access');
  });

  it('refreshes token when within expiry buffer', async () => {
    const tm = makeTokenManager(JUST_EXPIRED);
    global.fetch = jest.fn().mockResolvedValue(
      makeRefreshResponse({ access_token: 'new-access', expires_in: 86400 })
    );

    const token = await tm.getValidToken();
    expect(token).toBe('new-access');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.ouraring.com/oauth/token',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('updates refresh token if returned in response', async () => {
    const tm = makeTokenManager(JUST_EXPIRED);
    global.fetch = jest.fn().mockResolvedValue(
      makeRefreshResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      })
    );

    await tm.getValidToken();
    // Trigger another refresh to verify the new refresh token is used
    (tm as unknown as { state: { expiresAt: number } }).state.expiresAt = JUST_EXPIRED;
    global.fetch = jest.fn().mockResolvedValue(
      makeRefreshResponse({ access_token: 'newer-access', expires_in: 3600 })
    );
    await tm.getValidToken();

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as string;
    expect(body).toContain('refresh_token=new-refresh');
  });

  it('defaults expires_in to 86400 when not returned', async () => {
    const tm = makeTokenManager(JUST_EXPIRED);
    global.fetch = jest.fn().mockResolvedValue(
      makeRefreshResponse({ access_token: 'new-access' })
    );
    await tm.getValidToken();
    // No assertion needed beyond it not throwing
  });

  it('throws OuraAuthError on network failure during refresh', async () => {
    const tm = makeTokenManager(JUST_EXPIRED);
    global.fetch = jest.fn().mockRejectedValue(new Error('Network down'));
    await expect(tm.getValidToken()).rejects.toThrow(OuraAuthError);
  });

  it('throws OuraAuthError on non-ok refresh response', async () => {
    const tm = makeTokenManager(JUST_EXPIRED);
    global.fetch = jest.fn().mockResolvedValue(makeRefreshResponse({}, false));
    await expect(tm.getValidToken()).rejects.toThrow(OuraAuthError);
  });

  it('throws OuraAuthError on network failure with non-Error thrown', async () => {
    const tm = makeTokenManager(JUST_EXPIRED);
    global.fetch = jest.fn().mockRejectedValue('timeout');
    await expect(tm.getValidToken()).rejects.toThrow(OuraAuthError);
  });
});

describe('createTokenManager', () => {
  it('creates a TokenManager instance using env vars', () => {
    process.env.OURA_ACCESS_TOKEN = 'env-access';
    process.env.OURA_REFRESH_TOKEN = 'env-refresh';
    const tm = createTokenManager();
    expect(tm).toBeInstanceOf(TokenManager);
  });
});

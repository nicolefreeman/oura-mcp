import { OuraAuthError } from './types.js';
import { logger } from './logger.js';

interface TokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in seconds
}

const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const REFRESH_BUFFER_SECONDS = 60;

export class TokenManager {
  private state: TokenState;

  constructor(initialState: TokenState) {
    this.state = { ...initialState };
  }

  async getValidToken(): Promise<string> {
    const nowSeconds = Date.now() / 1000;
    if (this.state.expiresAt - nowSeconds < REFRESH_BUFFER_SECONDS) {
      logger.debug('Token expiring soon, refreshing', {
        expiresIn: Math.round(this.state.expiresAt - nowSeconds),
      });
      await this.refresh();
    }
    return this.state.accessToken;
  }

  private async refresh(): Promise<void> {
    logger.debug('Refreshing OAuth token');

    const clientId = process.env.OURA_CLIENT_ID!;
    const clientSecret = process.env.OURA_CLIENT_SECRET!;

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.state.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    let response: Response;
    try {
      response = await fetch(OURA_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch (err) {
      throw new OuraAuthError(
        `Token refresh failed — network error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      throw new OuraAuthError(
        `Token refresh failed with status ${response.status}. Re-authorise the app and update your .env file.`
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    this.state.accessToken = data.access_token;
    if (data.refresh_token) {
      this.state.refreshToken = data.refresh_token;
    }
    // Oura returns expires_in in seconds; default 24h if not provided
    const expiresIn = data.expires_in ?? 86400;
    this.state.expiresAt = Date.now() / 1000 + expiresIn;

    logger.debug('Token refreshed successfully', {
      expiresIn,
    });
  }
}

export const createTokenManager = (): TokenManager => {
  return new TokenManager({
    accessToken: process.env.OURA_ACCESS_TOKEN!,
    refreshToken: process.env.OURA_REFRESH_TOKEN!,
    // Treat the stored token as valid for 24h from startup — it will refresh on first expiry
    expiresAt: Date.now() / 1000 + 86400,
  });
};

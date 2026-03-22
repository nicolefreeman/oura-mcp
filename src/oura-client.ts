import {
  OuraAuthError,
  OuraForbiddenError,
  OuraNotFoundError,
  OuraValidationError,
  OuraAppUpdateError,
  OuraRateLimitError,
  OuraServerError,
  OuraResponse,
} from './types.js';
import { TokenManager } from './token-manager.js';
import { logger } from './logger.js';

const BASE_URL = 'https://api.ouraring.com';
const DEFAULT_MAX_PAGES = 20;

export class OuraClient {
  constructor(private tokenManager: TokenManager) {}

  async get<T>(
    path: string,
    params?: Record<string, string | number | boolean>
  ): Promise<T> {
    const token = await this.tokenManager.getValidToken();

    const url = new URL(`${BASE_URL}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    logger.debug(`GET ${url.pathname}${url.search}`);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new OuraServerError(
        `Network error calling Oura API: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    logger.debug(`Response status: ${response.status}`, { path });

    if (!response.ok) {
      this.handleErrorStatus(response.status);
    }

    return response.json() as Promise<T>;
  }

  async getPaginated<T>(
    path: string,
    params: Record<string, string | number>,
    maxPages: number = DEFAULT_MAX_PAGES
  ): Promise<T[]> {
    const results: T[] = [];
    let currentParams: Record<string, string | number> = { ...params };
    let page = 0;

    while (page < maxPages) {
      const response = await this.get<OuraResponse<T>>(path, currentParams);
      results.push(...response.data);
      page++;

      if (!response.next_token) {
        break;
      }

      currentParams = { ...currentParams, next_token: response.next_token };
    }

    logger.debug(`Paginated fetch complete`, { path, pages: page, total: results.length });
    return results;
  }

  private handleErrorStatus(status: number): never {
    switch (status) {
      case 401:
        throw new OuraAuthError('Token invalid or revoked. Re-authorise the app.');
      case 403:
        throw new OuraForbiddenError(
          'Access denied. Check that all required OAuth scopes were granted.'
        );
      case 404:
        throw new OuraNotFoundError('Resource not found.');
      case 422:
        throw new OuraValidationError('Invalid request parameters.');
      case 426:
        throw new OuraAppUpdateError(
          'Oura app update required to access this data type. Update the Oura app on your phone.'
        );
      case 429:
        throw new OuraRateLimitError(
          'Oura rate limit reached. Please wait a few minutes and try again.'
        );
      default:
        if (status >= 500) {
          throw new OuraServerError('Oura API server error. Try again shortly.');
        }
        throw new OuraServerError(`Unexpected HTTP status: ${status}`);
    }
  }
}

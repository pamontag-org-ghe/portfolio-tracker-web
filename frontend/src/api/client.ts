import axios, { AxiosError } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const api = axios.create({ baseURL });

const TOKEN_KEY = 'portfolio-tracker-token';

export function setAuthToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    localStorage.removeItem(TOKEN_KEY);
    delete api.defaults.headers.common.Authorization;
  }
}

export function loadStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) api.defaults.headers.common.Authorization = `Bearer ${token}`;
  return token;
}

const GENERIC_ERROR = 'There was an error during the execution of the operation requested.';

/**
 * Map an unknown thrown value (typically an axios error) to a user-facing
 * message. We prefer specific, actionable copy when we can recognize the
 * failure mode (no network, expired session, server outage…) and fall back to
 * the generic copy when we can't.
 */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    // No HTTP response at all → network / CORS / DNS / browser offline.
    if (!err.response) {
      if (err.code === 'ECONNABORTED') {
        return 'The request took too long and was cancelled. Please try again.';
      }
      if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
        return 'Cannot reach the server. Check your internet connection and try again.';
      }
      return GENERIC_ERROR;
    }
    const status = err.response.status;
    const data = err.response.data as { error?: string; details?: unknown } | undefined;
    const serverMsg = typeof data?.error === 'string' && data.error.trim().length > 0 ? data.error.trim() : null;
    switch (status) {
      case 400:
        return serverMsg ?? 'The request was invalid. Please check the data you entered.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You do not have permission to perform this operation.';
      case 404:
        return serverMsg ?? 'The requested resource was not found.';
      case 409:
        return serverMsg ?? 'This conflicts with existing data (possible duplicate).';
      case 413:
        return 'The file is too large to upload (maximum 20 MB).';
      case 422:
        return serverMsg ?? 'The data you submitted could not be processed.';
      case 429:
        return 'Too many requests in a short time. Please wait a moment and try again.';
    }
    if (status >= 500) {
      return serverMsg ?? 'The server is temporarily unavailable. Please try again in a minute.';
    }
    return serverMsg ?? GENERIC_ERROR;
  }
  const msg = (err as Error | undefined)?.message;
  if (typeof msg === 'string' && msg.trim().length > 0) return msg;
  return GENERIC_ERROR;
}

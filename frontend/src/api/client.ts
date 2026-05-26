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

export function apiErrorMessage(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { error?: string; details?: unknown } | undefined;
    if (data?.error) return data.error;
    return err.message;
  }
  return (err as Error)?.message ?? 'Request failed';
}

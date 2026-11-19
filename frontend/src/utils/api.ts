import axios from 'axios';

/**
 * Axios instance for the backend API.
 * In development Vite proxies `/api` to the backend (see vite.config.ts).
 * Set VITE_API_URL to call the API at a different origin.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { Accept: 'application/json' }
});

export function setAuthToken(token: string | null) {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Registers a callback that runs whenever an authenticated request gets a 401 (expired or revoked session). */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && error.config?.headers?.Authorization) {
      unauthorizedHandler?.();
    }
    return Promise.reject(error);
  }
);

/** Turns an API or network error into a message that can be shown to the user. */
export function getErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Unable to reach the server. Please try again.';
    }
    const message = (error.response.data as { error?: unknown } | undefined)?.error;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return fallback;
}

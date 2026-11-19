import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import axios from 'axios';
import { api, setAuthToken } from '@/utils/api';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user';
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LoginResponse {
  token: string;
  expiresAt: string;
  user: AuthUser;
}

const TOKEN_KEY = 'auth_token';

// "Remember me" keeps the token in localStorage (survives closing the browser).
// Otherwise it goes in sessionStorage and is lost when the tab/browser closes.
function readStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(readStoredToken());
  const user = ref<AuthUser | null>(null);
  const isAuthenticated = computed(() => !!token.value && !!user.value);
  let pendingCheck: Promise<boolean> | null = null;

  setAuthToken(token.value);

  function storeToken(newToken: string, remember: boolean) {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, newToken);
    token.value = newToken;
    setAuthToken(newToken);
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    token.value = null;
    user.value = null;
    setAuthToken(null);
  }

  async function login(email: string, password: string, remember = false) {
    const { data } = await api.post<LoginResponse>('/auth/login', { email, password, remember });
    storeToken(data.token, remember);
    user.value = data.user;
    return data.user;
  }

  /**
   * Resolves to true if there is a valid session. A stored token is checked with the
   * server once (e.g. after a page reload). Calls made at the same time share one request.
   */
  function ensureSession(): Promise<boolean> {
    if (!token.value) return Promise.resolve(false);
    if (user.value) return Promise.resolve(true);

    if (!pendingCheck) {
      pendingCheck = api
        .get<{ user: AuthUser }>('/auth/me')
        .then(({ data }) => {
          user.value = data.user;
          return true;
        })
        .catch((error) => {
          // 401 means the token is expired or revoked, so forget it. For network or
          // server errors keep the token: access is denied now but can be retried later.
          if (axios.isAxiosError(error) && error.response?.status === 401) {
            clearSession();
          }
          return false;
        })
        .finally(() => {
          pendingCheck = null;
        });
    }
    return pendingCheck;
  }

  async function logout() {
    const currentToken = token.value;
    clearSession();
    if (!currentToken) return;
    try {
      // Revoke the session on the server too. The local session is already cleared,
      // so a failure here does not keep the user logged in.
      await api.post('/auth/logout', null, { headers: { Authorization: `Bearer ${currentToken}` } });
    } catch {
      // Ignored on purpose: the server session will expire by itself.
    }
  }

  return { token, user, isAuthenticated, login, logout, ensureSession, clearSession };
});

import { createRouter, createWebHistory, type LocationQuery, type RouteLocationNormalized, type RouteLocationRaw } from 'vue-router';
import { routes } from 'vue-router/auto-routes';
import { useAuthStore } from '@/stores/auth';
import { onUnauthorized } from '@/utils/api';

export const LOGIN_PATH = '/authentication/login';
export const HOME_PATH = '/dashboard/default';

const rootRedirect = {
  path: '/',
  redirect: HOME_PATH
};

const notFoundRoute = {
  path: '/:pathMatch(.*)*',
  name: 'NotFound',
  component: () => import('@/pages/maintenance/error.vue'),
  meta: { requiresAuth: false }
};

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [rootRedirect, ...routes, notFoundRoute]
});

/**
 * Where to go after logging in: the `?redirect=` page if it is a safe internal path,
 * otherwise the dashboard home. Only same-app paths are accepted, so a crafted link
 * like `?redirect=//evil.com` cannot send the user to another site.
 */
export function getPostLoginPath(query: LocationQuery): string {
  const redirect = query.redirect;
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//') || redirect.startsWith('/\\')) {
    return HOME_PATH;
  }
  if (redirect === LOGIN_PATH || redirect.startsWith(`${LOGIN_PATH}?`)) {
    return HOME_PATH;
  }
  return redirect;
}

/** Login page location that brings the user back to `to` after logging in. */
function loginRedirect(to: RouteLocationNormalized): RouteLocationRaw {
  return to.fullPath === HOME_PATH ? LOGIN_PATH : { path: LOGIN_PATH, query: { redirect: to.fullPath } };
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // `meta` from a parent route (e.g. the (main) layout) applies to all of its child pages.
  const requiresAuth = to.matched.some((record) => record.meta.requiresAuth === true);

  if (requiresAuth && !(await auth.ensureSession())) {
    return loginRedirect(to);
  }

  if (to.path === LOGIN_PATH && (await auth.ensureSession())) {
    return getPostLoginPath(to.query);
  }
});

// If the session expires or is revoked while the dashboard is open, forget it and
// run the guard again for the current page (which then redirects to the login page).
onUnauthorized(() => {
  const auth = useAuthStore();
  if (!auth.isAuthenticated) return;
  auth.clearSession();
  const { path, query, hash } = router.currentRoute.value;
  router.replace({ path, query, hash, force: true });
});

import type { Href } from 'expo-router';

export interface BackCapableRouter {
  back: () => void;
  canGoBack: () => boolean;
  replace: (path: Href) => void;
}

export const DEFAULT_BACK_FALLBACK: Href = '/p-home';

export const goBackOrFallback = (
  router: BackCapableRouter,
  fallbackPath: Href = DEFAULT_BACK_FALLBACK,
) => {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallbackPath);
};

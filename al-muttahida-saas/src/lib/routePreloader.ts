export const routeImporters = {
  '/': () => import('../pages/Dashboard'),
  '/users': () => import('../pages/Users'),
  '/customers': () => import('../pages/Customers'),
  '/suppliers': () => import('../pages/Suppliers'),
  '/sales': () => import('../pages/Sales'),
  '/invoices': () => import('../pages/Invoices'),
  '/payments': () => import('../pages/Payments'),
  '/expenses': () => import('../pages/Expenses'),
  '/accounts': () => import('../pages/Accounts'),
  '/settings': () => import('../pages/Settings'),
  '/notifications': () => import('../pages/Notifications'),
  '/sales-reps': () => import('../pages/SalesReps'),
  '/collection-statement': () => import('../pages/CollectionStatement'),
  '/shareholders': () => import('../pages/Shareholders'),
  '/products-inventory': () => import('../pages/ProductsInventory'),
  '/onboarding': () => import('../pages/OnboardingWizard'),
} as const;

export type AppRoutePath = keyof typeof routeImporters;

const preloadedPaths = new Set<string>();
let backgroundPreloadStarted = false;

export function preloadRouteByPath(path: string): void {
  const normalized = path.split('?')[0] as AppRoutePath;
  const loader = routeImporters[normalized];
  if (!loader || preloadedPaths.has(normalized)) return;
  preloadedPaths.add(normalized);
  void loader().catch(() => {
    preloadedPaths.delete(normalized);
  });
}

export function preloadAllRoutesInBackground(): void {
  if (backgroundPreloadStarted || typeof window === 'undefined') return;
  backgroundPreloadStarted = true;

  const paths = (Object.keys(routeImporters) as AppRoutePath[]).filter((p) => p !== '/onboarding');
  let index = 0;

  const loadNextBatch = () => {
    const batch = paths.slice(index, index + 3);
    index += 3;
    for (const path of batch) {
      preloadRouteByPath(path);
    }
    if (index < paths.length) {
      window.setTimeout(loadNextBatch, 180);
    }
  };

  const ric = (window as any).requestIdleCallback as
    | ((cb: () => void, opts?: { timeout: number }) => number)
    | undefined;
  if (typeof ric === 'function') {
    ric(() => loadNextBatch(), { timeout: 600 });
  } else {
    window.setTimeout(loadNextBatch, 250);
  }
}

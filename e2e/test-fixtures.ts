import { test as base, type APIRequestContext, type BrowserContext } from '@playwright/test';
import { isTestRequest } from '../scripts/lib/test-target.mjs';
export * from '@playwright/test';
const guardedContexts = new WeakSet<BrowserContext>();
const frontends = ['http://127.0.0.1:5188', 'http://127.0.0.1:5190', 'http://127.0.0.1:5196', 'http://127.0.0.1:5198'];

function protectRequests(request: APIRequestContext, frontend: string) {
  // page.request bypasses browser routing. Check it before sending and disallow redirects.
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'] as const) {
    const original = request[method].bind(request);
    Object.defineProperty(request, method, { configurable: true, value: (target: string | { url(): string }, options = {}) => {
      const url = typeof target === 'string' ? target : target.url();
      if (!isTestRequest(url) && !url.startsWith(frontend + '/')) return Promise.reject(Error('Solicitud bloqueada: solo API/frontend/correo TEST local.'));
      return original(target as string, { ...options, maxRedirects: 0 });
    } });
  }
}

async function protectContext(context: BrowserContext, frontend: string) {
  if (!frontends.includes(frontend)) throw Error('Frontend fuera de los puertos locales TEST autorizados.');
  if (guardedContexts.has(context)) return;
  guardedContexts.add(context);
  await context.route('**/*', route => {
    const url = route.request().url();
    return isTestRequest(url, { browser: true }) || url.startsWith(frontend + '/') ? route.continue() : route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => {
    const url = socket.url().replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
    if (isTestRequest(url) || url.startsWith(frontend + '/')) socket.connectToServer();
    else socket.close({ code: 1008, reason: 'Solo TEST local' });
  });
  protectRequests(context.request, frontend);
}

export const test = base.extend<{ isolatedTestNetwork: void }>({
  browser: [async ({ browser }, use) => {
    const original = browser.newContext;
    browser.newContext = async options => {
      const context = await original.call(browser, { ...options, serviceWorkers: 'block' });
      await protectContext(context, options?.baseURL ?? 'http://127.0.0.1:5198');
      return context;
    };
    try { await use(browser); } finally { browser.newContext = original; }
  }, { scope: 'worker' }],
  isolatedTestNetwork: [async ({ context, request, baseURL }, use) => {
    // Keep the dedicated historical local runners usable; CI selects 5198 only.
    const frontend = baseURL ?? 'http://127.0.0.1:5198';
    await protectContext(context, frontend);
    protectRequests(request, frontend);
    await use();
  }, { auto: true }]
});

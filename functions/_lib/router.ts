import type { Ctx } from './types';

export type Handler = (c: Ctx) => Promise<Response> | Response;

export interface RouteOpts {
  /** Who may call the route. Defaults to 'user'. */
  auth?: 'public' | 'user' | 'super';
  /**
   * For routes with a `:who` param (`me` | `partner`):
   *  - 'read': caller may read their own or their partner's data
   *  - 'self': caller may only act on their own data
   *  - 'plan': plan editing rules (partner edits you; self only if allowed)
   */
  who?: 'read' | 'self' | 'plan';
}

interface Route {
  method: string;
  parts: string[];
  handler: Handler;
  opts: RouteOpts;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, opts: RouteOpts, handler: Handler): this {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler, opts });
    return this;
  }

  get = (path: string, opts: RouteOpts, h: Handler) => this.on('GET', path, opts, h);
  post = (path: string, opts: RouteOpts, h: Handler) => this.on('POST', path, opts, h);
  put = (path: string, opts: RouteOpts, h: Handler) => this.on('PUT', path, opts, h);
  patch = (path: string, opts: RouteOpts, h: Handler) => this.on('PATCH', path, opts, h);
  delete = (path: string, opts: RouteOpts, h: Handler) => this.on('DELETE', path, opts, h);

  /** Returns the matching route, `'method'` if only the method differs, or null. */
  match(method: string, pathname: string): { route: Route; params: Record<string, string> } | 'method' | null {
    const segs = pathname.split('/').filter(Boolean);
    let methodMismatch = false;
    for (const route of this.routes) {
      if (route.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const p = route.parts[i];
        if (p.startsWith(':')) {
          try {
            params[p.slice(1)] = decodeURIComponent(segs[i]);
          } catch {
            ok = false;
            break;
          }
        } else if (p !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (route.method !== method && !(method === 'HEAD' && route.method === 'GET')) {
        methodMismatch = true;
        continue;
      }
      return { route, params };
    }
    return methodMismatch ? 'method' : null;
  }
}

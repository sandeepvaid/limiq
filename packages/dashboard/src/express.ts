import { routeDashboard, type DashboardOptions } from "./router.js";

interface ReqLike {
  method: string;
  path?: string;
  url?: string;
  originalUrl?: string;
}
interface ResLike {
  setHeader(name: string, value: string): void;
  status(code: number): ResLike;
  send(body: string): void;
}
type Next = () => void;

/**
 * Express middleware that serves the dashboard + JSON API. Mount it directly:
 *   app.use(expressDashboard({ collector: limiter.getMetrics()!, limiter }))
 * Requests outside basePath are passed through to the next handler.
 */
export function expressDashboard(options: DashboardOptions) {
  const basePath = options.basePath ?? "/__ratelimit";
  const isAdmin = options.isAdmin ?? (() => false);

  return function dashboardMiddleware(req: ReqLike, res: ResLike, next: Next): void {
    const rawUrl = req.originalUrl ?? req.url ?? req.path ?? "/";
    const url = new URL(rawUrl, "http://internal");
    const path = req.path ?? url.pathname;

    if (!path.startsWith(basePath)) {
      next();
      return;
    }

    routeDashboard(
      { ...options, basePath },
      {
        method: req.method,
        path,
        query: url.searchParams,
        isAdmin: isAdmin(req),
      },
    )
      .then((r) => {
        res.setHeader("Content-Type", r.contentType);
        res.status(r.status).send(r.body);
      })
      .catch(() => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.status(500).send(JSON.stringify({ error: "Dashboard error" }));
      });
  };
}

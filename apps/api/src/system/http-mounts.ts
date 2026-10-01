import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { EngineConfig } from '../config/engine-config';

/** Self-hosted single-port mode: forwards `S3_BROWSER_PATH_PREFIX/*` to the
 * private S3 endpoint. Express strips the mount path, so the upstream sees
 * `/<bucket>/<key>?X-Amz-…` — the exact path the URL was presigned for — and
 * `changeOrigin` sends S3_ENDPOINT's Host, so the SigV4 signature still
 * matches. Mount before any body parser so uploads stream through intact. */
export function mountStorageProxy(app: Express, config: EngineConfig): void {
  const prefix = config.s3BrowserPathPrefix;
  if (!prefix) return;
  app.use(
    prefix,
    createProxyMiddleware({
      target: config.s3.endpoint,
      changeOrigin: true,
      // Uploads and long media streams may legitimately take a while.
      proxyTimeout: 30 * 60_000,
    }),
  );
}

/** Serves the built web app, with an `index.html` fallback for client-side
 * routes. API and storage paths are never swallowed by the fallback. */
export function mountWebApp(app: Express, config: EngineConfig): void {
  const distDir = config.webDistDir;
  if (!distDir) return;
  const reserved = ['/api', ...(config.s3BrowserPathPrefix ? [config.s3BrowserPathPrefix] : [])];
  const indexHtml = path.join(path.resolve(distDir), 'index.html');

  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        // Vite fingerprints everything under assets/; index.html must stay fresh.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isSpaRequest(req.method, req.path, reserved)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}

export function isSpaRequest(method: string, requestPath: string, reserved: string[]): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  return !reserved.some((prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`));
}

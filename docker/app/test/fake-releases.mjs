#!/usr/bin/env node
// A stand-in for the GitHub Releases API, used by update-test.sh. Every
// `reelcraft-<v>.manifest.json` in <dir> is one published release; its assets
// are the files in <dir> named for that version.
//
// Usage: fake-releases.mjs <dir> <port>
import { createReadStream, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const [dir, port] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}`;

function releases() {
  const files = readdirSync(dir);
  return files
    .map((file) => /^reelcraft-(.+)\.manifest\.json$/.exec(file)?.[1])
    .filter(Boolean)
    .map((version) => ({
      tag_name: `v${version}`,
      html_url: `${base}/releases/v${version}`,
      body: `Test release ${version}`,
      published_at: new Date().toISOString(),
      draft: false,
      prerelease: false,
      assets: files
        .filter(
          (f) => f.startsWith(`reelcraft-${version}.`) || f.startsWith(`reelcraft-app-${version}-`),
        )
        .map((name) => ({ name, browser_download_url: `${base}/assets/${name}` })),
    }));
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const url = new URL(req.url, base);
  const tag = /^\/repos\/[^/]+\/[^/]+\/releases\/tags\/([^/]+)$/.exec(url.pathname)?.[1];
  if (/^\/repos\/[^/]+\/[^/]+\/releases$/.test(url.pathname)) return json(res, 200, releases());
  if (tag) {
    const release = releases().find((r) => r.tag_name === decodeURIComponent(tag));
    return release ? json(res, 200, release) : json(res, 404, { message: 'Not Found' });
  }
  const asset = /^\/assets\/([^/]+)$/.exec(url.pathname)?.[1];
  if (asset) {
    const file = path.join(dir, path.basename(decodeURIComponent(asset)));
    const stream = createReadStream(file);
    stream.on('open', () => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      stream.pipe(res);
    });
    stream.on('error', () => json(res, 404, { message: 'Not Found' }));
    return;
  }
  json(res, 404, { message: 'Not Found' });
}).listen(Number(port), '127.0.0.1', () => console.log(`fake releases on ${base}`));

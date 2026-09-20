// Node `--require` preload for `acceptance:phase7-broll` (see package.json).
//
// `phase7-broll-frames.ts` builds and boots the real NestJS `AppModule` via
// `@nestjs/testing`'s `Test.createTestingModule()`, which needs
// `ConfigModule.forRoot({validate})` (in `src/config/config.module.ts`) to
// pass env validation the INSTANT that module is loaded — i.e. before the
// script's own top-level code has a chance to run. A `--require` preload is
// the one ordering Node guarantees runs first, so the repo-root `.env`
// (docker-compose's real DATABASE_URL/etc.) and a forced `NODE_ENV=test`
// (this is a test harness; `test` is also what exempts it from needing a
// real `PREVIEW_TOKEN_SECRET`, per `src/config/env.schema.ts`) land before
// `AppModule` is ever imported.
//
// A Node `--require` preload must be plain CommonJS (it runs before any
// ESM/TS loader is even registered), so `require()` here is load-bearing,
// not a style slip.
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
process.env.NODE_ENV = 'test';

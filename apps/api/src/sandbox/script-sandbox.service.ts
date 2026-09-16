import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSHandle,
  type QuickJSContext,
  type QuickJSWASMModule,
} from 'quickjs-emscripten-core';
// The `-cjs-` singlefile variant only — it embeds the wasm as base64 inside
// a CommonJS module, so there's no `.wasm` file to bundle (nest-cli.json
// needs no `assets` entry) and no `moduleResolution: "Node10"` risk (it
// declares a top-level `main`/`types`, exactly like `ajv`). The `-mjs-`
// variant is ESM-only: it would pass `pnpm test` (vitest transforms
// everything to ESM regardless of the app's CJS build target) and fail only
// at `nest build`/`node dist/main.js`. Never swap this import.
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { EngineConfig } from '../config/engine-config';

export interface SandboxCompileOutcome {
  ok: boolean;
  message?: string;
}

/** Every failure mode a script check can hit is a named variant here —
 * `ScriptSandboxService.evaluate` never throws for a script-authored fault,
 * only for host-side programmer error (calling before `ready()`). */
export type SandboxOutcome =
  | { status: 'ok'; value: unknown }
  | { status: 'threw'; message: string }
  | { status: 'timeout'; message: string }
  | { status: 'memory'; message: string }
  | { status: 'invalid_return'; message: string };

/**
 * §9.2 — the QuickJS sandbox for script checks. `BlueprintValidatorService`
 * needs `compiles()` for §16.2 and `CheckRunner` needs `evaluate()` for
 * §9.2, so this lives in its own zero-import module (mirrors
 * `json-schema/json-schema.module.ts`'s pattern) rather than inside
 * `check/` — `BlueprintModule` must not import `CheckModule`.
 *
 * No host bindings cross the boundary (§9.2): scope values are
 * `JSON.stringify`'d host-side, embedded as string literals, and
 * `JSON.parse`'d back inside the VM; only a `context.dump()`'d plain value
 * crosses back out. There is no handle-passing in either direction, so
 * there is nothing to leak.
 */
@Injectable()
export class ScriptSandboxService implements OnModuleInit {
  private module: QuickJSWASMModule | undefined;
  private modulePromise: Promise<QuickJSWASMModule> | undefined;

  constructor(private readonly config: EngineConfig) {}

  async onModuleInit(): Promise<void> {
    await this.ready();
  }

  /** Idempotent warmup. Nest guarantees `onModuleInit` completes before the
   * app serves traffic; unit tests call this directly in `beforeAll`. */
  async ready(): Promise<void> {
    if (this.module) return;
    this.modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
    this.module = await this.modulePromise;
  }

  /** §16.2 — save-time "script check fails to compile". Compiles without
   * running (no side effects, no timeout/memory limits needed). */
  compiles(code: string): SandboxCompileOutcome {
    const quickjs = this.requireModule();
    const runtime = quickjs.newRuntime();
    try {
      const context = runtime.newContext();
      try {
        const result = context.evalCode(wrapScript(code), 'check.js', { compileOnly: true });
        if (result.error !== undefined) {
          const message = describeError(context, result.error);
          result.error.dispose();
          return { ok: false, message };
        }
        result.value.dispose();
        return { ok: true };
      } finally {
        context.dispose();
      }
    } finally {
      runtime.dispose();
    }
  }

  /** §9.2 — pure evaluation. One fresh Runtime+Context per call, disposed in
   * `finally` regardless of outcome — a poisoned runtime (OOM/timeout) must
   * never contaminate the shared `QuickJSWASMModule`. */
  evaluate(code: string, scope: Record<string, unknown>): SandboxOutcome {
    const quickjs = this.requireModule();
    const runtime = quickjs.newRuntime();
    try {
      runtime.setMemoryLimit(this.config.sandboxMemoryMb * 1024 * 1024);
      runtime.setInterruptHandler(
        shouldInterruptAfterDeadline(Date.now() + this.config.sandboxTimeoutMs),
      );
      const context = runtime.newContext();
      try {
        const source = buildSource(code, scope);
        const result = context.evalCode(source, 'check.js');
        if (result.error !== undefined) {
          const message = describeError(context, result.error);
          result.error.dispose();
          return classifyFailure(message);
        }
        try {
          return { status: 'ok', value: context.dump(result.value) };
        } catch (err) {
          return {
            status: 'invalid_return',
            message: `script returned a value that could not be extracted: ${
              err instanceof Error ? err.message : String(err)
            }`,
          };
        } finally {
          result.value.dispose();
        }
      } finally {
        context.dispose();
      }
    } finally {
      runtime.dispose();
    }
  }

  private requireModule(): QuickJSWASMModule {
    if (!this.module) {
      throw new Error(
        'ScriptSandboxService: not ready — call ready() (or await app bootstrap) before use',
      );
    }
    return this.module;
  }
}

/** Wraps a check script's body as an IIFE so `return {...}` works, matching
 * the mental model of "write a function body". */
function wrapScript(code: string): string {
  return `(function(){\n${code}\n})()`;
}

function buildSource(code: string, scope: Record<string, unknown>): string {
  const prelude = Object.entries(scope)
    .map(([key, value]) => `const ${key} = JSON.parse(${JSON.stringify(JSON.stringify(value))});`)
    .join('\n');
  return `${prelude}\n${wrapScript(code)}`;
}

function describeError(context: QuickJSContext, error: QuickJSHandle): string {
  try {
    const dumped: unknown = context.dump(error);
    if (dumped && typeof dumped === 'object' && 'message' in dumped) {
      return String((dumped as { message: unknown }).message);
    }
    return String(dumped);
  } catch {
    return 'unknown script error';
  }
}

function classifyFailure(message: string): SandboxOutcome {
  const lower = message.toLowerCase();
  if (lower.includes('interrupt')) return { status: 'timeout', message };
  // "out of memory" is the WASM heap hitting `setMemoryLimit`; "string too
  // long"/"array too long" are QuickJS's own internal size ceilings, hit by
  // e.g. unbounded string-doubling before the heap limit trips — both are
  // the same class of authoring fault (unbounded growth) from a check's
  // perspective. Verified empirically against the installed engine, not
  // guessed — see script-sandbox.service.test.ts.
  if (lower.includes('memory') || lower.includes('malloc') || lower.includes('too long')) {
    return { status: 'memory', message };
  }
  return { status: 'threw', message };
}

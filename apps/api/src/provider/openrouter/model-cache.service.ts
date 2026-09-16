import { Injectable } from '@nestjs/common';
import type { ModelInfo } from '../provider-adapter.interface';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // §8 — cached ~24h

/** Caches OpenRouter's /models response so cost estimation (§8) doesn't
 * hit the network on every call. */
@Injectable()
export class ModelCacheService {
  private cached: { at: number; models: ModelInfo[] } | undefined;

  get(): ModelInfo[] | undefined {
    if (!this.cached) return undefined;
    if (Date.now() - this.cached.at > CACHE_TTL_MS) return undefined;
    return this.cached.models;
  }

  set(models: ModelInfo[]): void {
    this.cached = { at: Date.now(), models };
  }
}

// Lives in web, not `packages/shared`: it's the only plain function that
// package would export, and `apps/web`'s bundler (Rollup, via Vite) can't
// resolve a runtime named export through that CJS package's `__exportStar`
// re-export chain — every other cross-boundary use is `import type`, erased
// before bundling. Nothing outside web needs this formatting.
export function formatBlueprintVersion(v: { major: number; minor: number }): string {
  return `v${v.major}.${v.minor}`;
}

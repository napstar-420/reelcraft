import type { PackageManifest, PackagePipeline } from '@reelcraft/shared';

/** Capabilities and providers a pipeline uses: written into the manifest on
 * export, and worked out again on import (the manifest's claim is not trusted). */
export function requiresOf(
  graph: PackagePipeline['graph'],
  defaults: PackagePipeline['defaults'],
): PackageManifest['requires'] {
  const capabilities = new Set<string>();
  const providers = new Set<string>();
  for (const stage of graph) {
    capabilities.add(stage.capability);
    if (stage.model?.provider) providers.add(stage.model.provider);
    if (stage.qc?.model.provider) providers.add(stage.qc.model.provider);
  }
  if (defaults.model?.provider) providers.add(defaults.model.provider);
  return { capabilities: [...capabilities].sort(), providers: [...providers].sort() };
}

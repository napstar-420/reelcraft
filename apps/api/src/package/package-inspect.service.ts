import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type {
  PackageInspectReportDto,
  PackageInstalledDto,
  PackageSignerDto,
} from '@reelcraft/shared';
import { CapabilityRegistry } from '../capability/capability.registry';
import { EngineConfig } from '../config/engine-config';
import { DRIZZLE, type Db } from '../db/drizzle.provider';
import { blueprint, blueprintVersion, packageImport } from '../db/schema';
import { isProviderKeyId, KEY_PROVIDER, type KeyProvider } from '../provider/key-provider';
import { IdentityService } from './identity.service';
import { openPackage, type OpenedPackage, type PackageIssue } from './package-open';
import { requiresOf } from './package-requires';
import { PackageUploadService } from './package-upload.service';

export interface Inspected {
  report: PackageInspectReportDto;
  /** Null when the package was rejected. */
  opened: OpenedPackage | null;
  installed: InstalledRow | null;
  /** This install's own signing fingerprint. */
  ownFingerprint: string | null;
}

interface InstalledRow {
  blueprintId: string;
  blueprintName: string;
  version: string;
  contentHash: string | null;
  authorFingerprint: string | null;
  hasWorkingDraft: boolean;
}

const NO_SIGNER: PackageSignerDto = {
  fingerprint: null,
  signed: false,
  trusted: false,
  own: false,
};

function parseVersion(version: string): [number, number] {
  const [major, minor] = version.split('.').map(Number);
  return [major ?? 0, minor ?? 0];
}

/**
 * Everything an importer should know before installing: the file's own
 * problems (`openPackage`), then what depends on this install: capabilities,
 * providers, who signed it, and what is already installed from it.
 */
@Injectable()
export class PackageInspectService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    @Inject(KEY_PROVIDER) private readonly keys: KeyProvider,
    private readonly uploads: PackageUploadService,
    private readonly identity: IdentityService,
    private readonly capabilities: CapabilityRegistry,
    private readonly config: EngineConfig,
  ) {}

  async inspect(ownerId: string, objectKey: string, channelId: string): Promise<Inspected> {
    const bytes = await this.uploads.read(ownerId, objectKey);
    if (!bytes) {
      return this.rejected([
        {
          severity: 'block',
          code: 'too_large',
          message: 'This file is too large to be a Reelcraft package.',
        },
      ]);
    }
    const { issues, opened } = openPackage(bytes, { currentVersion: this.config.version });
    if (!opened) return this.rejected(issues);

    const { manifest, pipeline } = opened;
    const requires = requiresOf(pipeline.graph, pipeline.defaults);
    const status = await this.identity.status();
    const ownFingerprint = status.status === 'ready' ? status.identity.fingerprint : null;

    const fingerprint = opened.signed ? manifest.author.fingerprint : null;
    const own = fingerprint !== null && fingerprint === ownFingerprint;
    const trusted = own || (fingerprint !== null && (await this.identity.isTrusted(fingerprint)));
    const signer: PackageSignerDto = { fingerprint, signed: opened.signed, trusted, own };
    if (opened.signed && !trusted) {
      issues.push({
        severity: 'warn',
        code: 'unknown_author',
        message: 'This package is from an author you have not trusted yet.',
      });
    }

    const known = new Set(this.capabilities.list().map((c) => c.key));
    for (const stage of pipeline.graph) {
      if (!known.has(stage.capability)) {
        issues.push({
          severity: 'block',
          code: 'unknown_capability',
          message: `Stage "${stage.label}" needs "${stage.capability}", which this version of Reelcraft does not have. Update Reelcraft, or ask the author for another version.`,
          path: stage.key,
        });
      }
      const accounts = stage.config.accounts;
      if (stage.capability === 'browser.flow_video' && Array.isArray(accounts) && accounts.length) {
        issues.push({
          severity: 'warn',
          code: 'machine_specific',
          message: `Stage "${stage.label}" names Google accounts from the author's computer. Change them in the stage's settings.`,
          path: stage.key,
        });
      }
    }
    for (const provider of requires.providers) {
      if (isProviderKeyId(provider) && !(await this.keys.get(provider))) {
        issues.push({
          severity: 'warn',
          code: 'provider_not_configured',
          message: `Uses ${provider}, which has no key in Settings. The blueprint can't run until you add one or change the model.`,
          path: provider,
        });
      }
    }

    const installed = await this.findInstalled(manifest.package.id, channelId, ownFingerprint);
    const installedDto = installed ? this.relate(installed, opened, fingerprint, issues) : null;

    return {
      report: {
        summary: {
          name: manifest.meta.name,
          description: manifest.meta.description,
          tags: manifest.meta.tags,
          packageId: manifest.package.id,
          version: manifest.package.version,
          exportedBy: manifest.exportedBy,
        },
        signer,
        slots: manifest.slots,
        requires,
        issues,
        installed: installedDto,
        suggestedName: await this.freeName(channelId, manifest.meta.name),
      },
      opened,
      installed,
      ownFingerprint,
    };
  }

  private rejected(issues: PackageIssue[]): Inspected {
    return {
      report: {
        summary: null,
        signer: NO_SIGNER,
        slots: [],
        requires: { capabilities: [], providers: [] },
        issues,
        installed: null,
        suggestedName: null,
      },
      opened: null,
      installed: null,
      ownFingerprint: null,
    };
  }

  /** How this package relates to the blueprint already made from it. Adds the
   * warnings that go with that relation to `issues`. */
  private relate(
    installed: InstalledRow,
    opened: OpenedPackage,
    signerFingerprint: string | null,
    issues: PackageIssue[],
  ): PackageInstalledDto {
    const [pMajor, pMinor] = parseVersion(opened.manifest.package.version);
    const [iMajor, iMinor] = parseVersion(installed.version);
    const order = pMajor - iMajor || pMinor - iMinor;

    let relation: PackageInstalledDto['relation'];
    if (signerFingerprint === null || signerFingerprint !== installed.authorFingerprint) {
      relation = 'other-signer';
    } else if (order > 0) {
      relation = 'newer';
    } else if (order < 0) {
      relation = 'older';
    } else if (installed.contentHash !== null && installed.contentHash !== opened.contentHash) {
      relation = 'modified';
    } else {
      relation = 'same';
    }

    const message: Partial<Record<PackageInstalledDto['relation'], string>> = {
      same: `"${installed.blueprintName}" is already installed from this package.`,
      older: `This is an older version (${opened.manifest.package.version}) than the one installed (${installed.version}).`,
      modified:
        'This package has the same version as the one installed but different contents. It can only be installed as a separate copy.',
      'other-signer':
        'A blueprint from a package with the same id is installed, but it was signed by someone else, so this can only be installed as a separate copy.',
    };
    const text = message[relation];
    if (text) issues.push({ severity: 'warn', code: `installed_${relation}`, message: text });
    if (installed.hasWorkingDraft && (relation === 'newer' || relation === 'older')) {
      issues.push({
        severity: 'warn',
        code: 'working_draft',
        message: `"${installed.blueprintName}" has unsaved edits on its canvas. They are kept as a draft on the version it has now; the canvas asks whether to open them.`,
      });
    }

    return {
      blueprintId: installed.blueprintId,
      blueprintName: installed.blueprintName,
      version: installed.version,
      relation,
      canUpdate: relation === 'newer' || relation === 'older',
      hasWorkingDraft: installed.hasWorkingDraft,
    };
  }

  /** The blueprint in `channelId` that came from this package: the latest
   * import, or a blueprint this install exported the package from. */
  private async findInstalled(
    packageId: string,
    channelId: string,
    ownFingerprint: string | null,
  ): Promise<InstalledRow | null> {
    const [imported] = await this.db
      .select({ imp: packageImport, bp: blueprint })
      .from(packageImport)
      .innerJoin(blueprint, eq(blueprint.id, packageImport.blueprintId))
      .where(and(eq(packageImport.packageId, packageId), eq(blueprint.channelId, channelId)))
      .orderBy(desc(packageImport.importedAt))
      .limit(1);
    if (imported) {
      return {
        blueprintId: imported.bp.id,
        blueprintName: imported.bp.name,
        version: imported.imp.packageVersion,
        contentHash: imported.imp.contentHash,
        authorFingerprint: imported.imp.authorFingerprint,
        hasWorkingDraft: imported.bp.workingDraft !== null,
      };
    }
    const [exported] = await this.db
      .select()
      .from(blueprint)
      .where(and(eq(blueprint.channelId, channelId), eq(blueprint.packageId, packageId)))
      .limit(1);
    if (!exported) return null;
    const [current] = exported.currentVersionId
      ? await this.db
          .select({ major: blueprintVersion.major, minor: blueprintVersion.minor })
          .from(blueprintVersion)
          .where(eq(blueprintVersion.id, exported.currentVersionId))
          .limit(1)
      : [];
    return {
      blueprintId: exported.id,
      blueprintName: exported.name,
      version: current ? `${current.major}.${current.minor}` : '0.0',
      contentHash: null,
      authorFingerprint: ownFingerprint,
      hasWorkingDraft: exported.workingDraft !== null,
    };
  }

  /** `name`, or the first "name (2)", "name (3)" not used in the channel. */
  private async freeName(channelId: string, name: string): Promise<string> {
    const rows = await this.db
      .select({ name: blueprint.name })
      .from(blueprint)
      .where(eq(blueprint.channelId, channelId));
    const taken = new Set(rows.map((r) => r.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) {
      if (!taken.has(`${name} (${n})`)) return `${name} (${n})`;
    }
  }
}

import type { PackagePrivacyFlagDto } from '@reelcraft/shared';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const SECRET =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,})/;

/** Where, inside `value`, a string looks like an email address or a secret
 * (API key, bearer token). Paths read like `graph[0].config.accounts[1]`.
 * Never returns the matching text. */
export function findPrivacyFlags(value: unknown, path = ''): PackagePrivacyFlagDto[] {
  if (typeof value === 'string') {
    if (SECRET.test(value)) return [{ path, kind: 'secret' }];
    if (EMAIL.test(value)) return [{ path, kind: 'email' }];
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findPrivacyFlags(item, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) =>
      findPrivacyFlags(item, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

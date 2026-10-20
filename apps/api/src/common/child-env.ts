/**
 * What child processes may inherit. An allowlist, never `process.env`: that holds the database
 * password and provider keys, which a child (Python, Blender, and any code they run) has no
 * business reading.
 */
const INHERITED = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'PATHEXT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMDATA',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
]);

/** The allowlisted part of `base`, plus any variable `also` accepts (by its upper-case name). */
export function inheritedEnv(
  base: NodeJS.ProcessEnv,
  also: (name: string) => boolean = () => false,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    const name = key.toUpperCase();
    if (value !== undefined && (INHERITED.has(name) || also(name))) out[key] = value;
  }
  return out;
}

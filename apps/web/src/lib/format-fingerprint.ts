/** A key fingerprint the way people read keys: `ab12 cd34 …`. */
export function formatFingerprint(fingerprint: string): string {
  return fingerprint.replace(/(.{4})(?=.)/g, '$1 ');
}

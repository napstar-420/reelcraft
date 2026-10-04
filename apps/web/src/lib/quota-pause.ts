/** The line shown on a run paused for provider quota (`PAUSED_QUOTA`). */
export function quotaPauseMessage(
  resumeAt: string | null | undefined,
  format: (when: Date) => string,
): string {
  const when = resumeAt ? new Date(resumeAt) : undefined;
  const base = 'Paused: every Flow account is out of credits.';
  return when && !Number.isNaN(when.getTime())
    ? `${base} It resumes by itself around ${format(when)}, or resume it now to try again.`
    : `${base} Resume it to try again.`;
}

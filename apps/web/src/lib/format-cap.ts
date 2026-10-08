/** A run's spending cap for display: a cap of zero means there is no limit. */
export function formatCapUsd(capUsd: number): string {
  return capUsd > 0 ? `$${capUsd.toFixed(2)}` : 'Unlimited';
}

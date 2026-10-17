import { StageDetailsWorkspace, type StageDetailsProps } from './stage-details-workspace';
/** Compatibility entry point; switching tabs preserves item and attempt selection. */
export function StageAttemptsSheet(props: StageDetailsProps) {
  return <StageDetailsWorkspace {...props} initialTab="Attempts" />;
}

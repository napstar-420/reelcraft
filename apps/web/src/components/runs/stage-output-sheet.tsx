import { StageDetailsWorkspace, type StageDetailsProps } from './stage-details-workspace';
/** Compatibility entry point; both surfaces use the same details implementation. */
export function StageOutputSheet(props: StageDetailsProps) {
  return <StageDetailsWorkspace {...props} initialTab="Output" />;
}

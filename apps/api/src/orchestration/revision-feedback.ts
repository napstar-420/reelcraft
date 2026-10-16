import type { CheckResult } from '../check/check.types';
import type { QcVerdict } from '../qc/qc-runner.service';

export interface FeedbackAttempt {
  attemptNo: number;
  outcome: string;
  checkResults?: unknown;
  qcVerdict?: unknown;
}

export function feedbackForAttempt(attempt: FeedbackAttempt): string | undefined {
  if (attempt.outcome === 'check_failed') {
    const failed = ((attempt.checkResults as CheckResult[] | null) ?? [])
      .filter((result) => !result.pass)
      .map((result) => `- ${result.name}${result.message ? `: ${result.message}` : ''}`);
    return `Attempt ${attempt.attemptNo} failed these checks:\n${failed.join('\n')}`;
  }
  if (attempt.outcome === 'qc_failed') {
    const verdict = attempt.qcVerdict as QcVerdict | null;
    const lines = [`Attempt ${attempt.attemptNo} was rejected by QC: ${verdict?.critique ?? ''}`];
    if (verdict?.score !== undefined) lines.push(`Score: ${verdict.score}`);
    for (const dimension of verdict?.dimensions ?? []) {
      lines.push(
        `${dimension.key}: ${dimension.score}${dimension.critique ? ` — ${dimension.critique}` : ''}`,
      );
    }
    if (verdict?.failedClips?.length) {
      lines.push(`Clips to make again (their index): ${verdict.failedClips.join(', ')}`);
    }
    return lines.join('\n');
  }
  return undefined;
}

export function revisionPrompt(
  feedback: string,
  modality: string,
  output: { kind: string; schema?: unknown },
): string {
  if (modality === 'image') {
    return `Edit the single image from your immediately previous response using the rejection feedback below.\n\nPreserve the existing subject identity, composition, framing, camera, style, colours, lighting and all other details that already satisfy the original request. Change only what is necessary to correct the rejected details. Produce one revised final image.\n\n<rejection_feedback>\n${feedback}\n</rejection_feedback>`;
  }
  const format =
    output.kind === 'data' || output.kind === 'timeline'
      ? `\nReturn complete ${output.kind === 'timeline' ? 'ReelCraft timeline ' : ''}JSON matching the original output schema.\n${output.schema ? JSON.stringify(output.schema) : ''}`
      : '';
  return `Revise your immediately previous output using the rejection feedback below.\n\nPreserve everything that already satisfies the original request. Make the smallest changes needed to fix the reported problems. Do not remove or rewrite unrelated correct content unless required for consistency.\n\nReturn a complete replacement output in the same format required by the original request. Do not return a diff, patch, explanation, or commentary.${format}\n\n<rejection_feedback>\n${feedback}\n</rejection_feedback>`;
}

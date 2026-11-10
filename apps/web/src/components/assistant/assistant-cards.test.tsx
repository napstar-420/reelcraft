import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalPayload, AssistantItemDto } from '@reelcraft/shared';
import type { AssistantController } from '@/hooks/useAssistant';
import { ApprovalCard } from './assistant-cards';

function renderApproval(uncertainAttemptIds?: string[]) {
  const payload: ApprovalPayload = {
    tool: 'resume_run',
    kind: 'action',
    title: 'Resume the run',
    details: ['Restarting these requests may incur additional charges.'],
    costUsd: 1,
    ...(uncertainAttemptIds && { uncertainAttemptIds }),
  };
  const item: AssistantItemDto = {
    id: 'approval',
    sessionId: 'session',
    turnId: 'turn',
    seq: 1,
    type: 'approval',
    state: 'pending',
    payload,
    createdAt: '',
    updatedAt: '',
  };
  return renderToStaticMarkup(
    <ApprovalCard item={item} assistant={{ deciding: false } as AssistantController} />,
  );
}

describe('uncertain restart approval card', () => {
  it('offers an explicit risk acceptance without blanket approval choices', () => {
    const html = renderApproval(['interrupted-attempt']);
    expect(html).toContain('Accept risk and restart');
    expect(html).toContain('may incur additional charges');
    expect(html).not.toContain('Yes, and switch to Auto');
    expect(html).not.toContain('Yes to everything this turn');
  });

  it('keeps blanket choices for ordinary approvals including older cards', () => {
    for (const ids of [undefined, []]) {
      const html = renderApproval(ids);
      expect(html).not.toContain('Accept risk and restart');
      expect(html).toContain('Yes, and switch to Auto');
      expect(html).toContain('Yes to everything this turn');
    }
  });
});

describe('skip checks approval card', () => {
  it('offers only its own explicit Yes', () => {
    const payload: ApprovalPayload = {
      tool: 'supply_output',
      kind: 'action',
      title: 'Use this output',
      details: [],
      costUsd: null,
      skipsChecks: true,
    };
    const html = renderToStaticMarkup(
      <ApprovalCard
        item={
          {
            id: 'a',
            sessionId: 's',
            turnId: 't',
            seq: 1,
            type: 'approval',
            state: 'pending',
            payload,
            createdAt: '',
            updatedAt: '',
          } as AssistantItemDto
        }
        assistant={{ deciding: false } as AssistantController}
      />,
    );
    expect(html).toContain('Skip checks and use it');
    expect(html).not.toContain('Yes, and switch to Auto');
    expect(html).not.toContain('Yes to everything this turn');
  });
});

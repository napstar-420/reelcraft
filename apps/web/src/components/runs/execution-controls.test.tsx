import { Children, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StageAvailableActions } from '@reelcraft/shared';
import { StageExecutionControls, type StageActionRequest } from './execution-controls';
function elements(node: ReactNode): Array<{ props: Record<string, unknown> }> {
  const result: Array<{ props: Record<string, unknown> }> = [];
  Children.forEach(node, (child) => {
    if (isValidElement(child)) {
      const props = child.props as Record<string, unknown>;
      result.push({ props });
      result.push(...elements(props.children as ReactNode));
    }
  });
  return result;
}
const ready: StageAvailableActions = {
  run: false,
  continue: true,
  rerun: true,
  blockedReason: null,
  completedItems: 6,
  totalItems: 14,
};
describe.each(['run page', 'canvas Run tab', 'canvas card'])('%s action matrix', (surface) => {
  const compact = surface !== 'run page';
  it.each([
    { label: 'Run this stage only', request: { scope: 'stage' } },
    { label: 'Run up to this stage', request: { scope: 'through' } },
    { label: 'Run from this stage to the end', request: { scope: 'descendants' } },
  ] as const)('sends the $label request', ({ label, request }) => {
    const requests: unknown[] = [];
    const tree = StageExecutionControls({
      available: ready,
      busy: false,
      pending: false,
      compact,
      onAction: (sent: StageActionRequest) => requests.push(sent),
    });
    const control = elements(tree).find(
      (element) =>
        element.props.children === label && (element.props.onClick || element.props.onSelect),
    );
    expect(control).toBeDefined();
    const invoke = (control!.props.onClick ?? control!.props.onSelect) as () => void;
    invoke();
    expect(requests).toEqual([request]);
  });
  it('offers Re-check output only when allowed', () => {
    const labels = (allowRecheck: boolean) =>
      elements(
        StageExecutionControls({
          available: ready,
          busy: false,
          pending: false,
          compact,
          allowRecheck,
          onAction: () => {},
        }),
      ).map((element) => element.props.children);
    expect(labels(true)).toContain('Re-check output');
    expect(labels(false)).not.toContain('Re-check output');
  });
  it('shows separate item progress and hides execution buttons while busy', () => {
    const html = renderToStaticMarkup(
      <StageExecutionControls
        available={ready}
        busy
        pending={false}
        compact={compact}
        onAction={() => {
          throw new Error('must not run');
        }}
      />,
    );
    expect(html).toContain('6/14 completed');
    expect(html).not.toContain('<button');
  });
  it('shows blocking reason without a stage-run button', () => {
    const html = renderToStaticMarkup(
      <StageExecutionControls
        available={{
          ...ready,
          continue: false,
          rerun: false,
          runThrough: false,
          blockedReason: 'Waiting for Scene Breakdown.',
        }}
        busy={false}
        pending={false}
        compact={compact}
        onAction={() => {}}
      />,
    );
    expect(html).toContain('Waiting for Scene Breakdown.');
    expect(html).not.toContain('<button');
  });
});

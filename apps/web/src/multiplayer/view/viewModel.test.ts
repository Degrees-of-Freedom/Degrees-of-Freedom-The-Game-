import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ElementInspector } from './ElementInspector';
import { sceneFixture } from './fixtures';
import { canEditMember, draftEditIssue, freshness, quarterPorts } from './viewModel';
import type { MemberView } from './types';
import { createElement } from 'react';

describe('inspection boundaries', () => {
  const member = sceneFixture.members[4];
  const draft: MemberView = { ...member, phase: 'draft' };
  it('allows shorter diagonal drafts but rejects overlong/out-of-board/degenerate edits', () => {
    expect(draftEditIssue(draft, { end: [9, 9, 6] }, sceneFixture.board)).toBeNull();
    expect(draftEditIssue(draft, { end: [15, 0, 0] }, sceneFixture.board)).toContain('maximum');
    expect(draftEditIssue(draft, { end: [16, 0, 0] }, sceneFixture.board)).toContain('bounds');
    expect(draftEditIssue(draft, { end: draft.start }, sceneFixture.board)).toContain('positive');
    expect(draftEditIssue(draft, { end: [NaN, 0, 0] }, sceneFixture.board)).toContain('finite');
  });
  it('never enables committed or setup physical edits', () => {
    expect(canEditMember(member)).toBe(false);
    expect(canEditMember({ ...draft, setupLocked: true })).toBe(false);
    expect(draftEditIssue(member, { end: [9, 9, 6] }, sceneFixture.board)).toContain('read-only');
  });
  it('keeps original-reference quarter fractions and inputs intact', () => {
    const a = Object.freeze([1, 2, 3] as const), b = Object.freeze([4, 6, 8] as const);
    expect(quarterPorts('m', a, b).map(p => p.position)).toEqual([[1.75, 3, 4.25], [2.5, 4, 5.5], [3.25, 5, 6.75]]);
    expect(a).toEqual([1, 2, 3]);
  });
  it('renders a persistent read-only panel with stiffness, original masks and neutral override', () => {
    let actions = 0;
    const html = renderToStaticMarkup(createElement(ElementInspector, { data: sceneFixture, memberId: member.id, onClose: () => actions++, onDraftChange: () => actions++ }));
    expect(html).toContain('read-only'); expect(html).not.toContain('Apply draft endpoint');
    expect(html).toContain('10000'); expect(html).toContain('no player points'); expect(html).toContain('Original start rotations');
    expect(actions).toBe(0);
  });
  it('offers draft endpoints only through a provided callback', () => {
    const data = { ...sceneFixture, members: [draft] };
    const props = { data, memberId: draft.id, onClose() {} };
    expect(renderToStaticMarkup(createElement(ElementInspector, props))).not.toContain('Apply draft endpoint');
    expect(renderToStaticMarkup(createElement(ElementInspector, { ...props, onDraftChange() {} }))).toContain('Apply draft endpoint');
  });
  it('labels stale evidence and omits its segment values', () => {
    const data = { ...sceneFixture, revision: 'later' };
    expect(freshness(data)).toContain('current structure not yet analyzed');
    const html = renderToStaticMarkup(createElement(ElementInspector, { data, memberId: member.id, onClose() {} }));
    expect(html).toContain('No current segment results'); expect(html).not.toContain('action 600');
  });
});

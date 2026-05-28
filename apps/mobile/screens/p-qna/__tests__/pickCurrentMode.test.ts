/**
 * Pure-function tests for the mode-precedence rule that drives the
 * `<ModeBadge>` in the QnA page header. Keeping this as a unit test
 * (rather than a screen test) avoids the jest-expo + react-test-
 * renderer setup cost for what is fundamentally a list reducer.
 */

import { pickCurrentMode } from '../mode';

// Minimal shape that satisfies pickCurrentMode's typing. Cast at the
// call sites so we don't have to import the full ChatMessage type
// (which pulls a bigger surface from the screen module).
const userMsg = (id: string) => ({
  id,
  role: 'user' as const,
  content: 'q',
  createdAt: '2026-05-28T00:00:00Z',
  status: 'sent' as const,
});

const assistantMsg = (
  id: string,
  status: 'sent' | 'loading' | 'error',
  mode?: 'strict' | 'precise',
) => ({
  id,
  role: 'assistant' as const,
  content: 'a',
  createdAt: '2026-05-28T00:00:00Z',
  status,
  metadata: mode ? { redactionMode: mode } : undefined,
});

describe('pickCurrentMode', () => {
  it('returns null for an empty conversation', () => {
    expect(pickCurrentMode([])).toBeNull();
  });

  it('returns null when only user messages have been sent', () => {
    expect(pickCurrentMode([userMsg('u1'), userMsg('u2')])).toBeNull();
  });

  it('returns null when the only assistant message is still loading', () => {
    // The orchestrator picks the mode per-call based on the live
    // consent state, so claiming a mode before the answer commits
    // to one would be a lie.
    expect(pickCurrentMode([userMsg('u1'), assistantMsg('a1', 'loading')])).toBeNull();
  });

  it('returns null when an assistant message errored before a mode could be assigned', () => {
    expect(pickCurrentMode([userMsg('u1'), assistantMsg('a1', 'error')])).toBeNull();
  });

  it("returns the most recent successful answer's mode", () => {
    const conv = [
      assistantMsg('a1', 'sent', 'strict'),
      userMsg('u2'),
      assistantMsg('a2', 'sent', 'precise'),
    ];
    expect(pickCurrentMode(conv)).toBe('precise');
  });

  it("skips over a trailing loading bubble and reports the prior answer's mode", () => {
    // While the next answer is in flight we keep the previous chip
    // visible — otherwise the badge would flicker off mid-question.
    const conv = [
      assistantMsg('a1', 'sent', 'strict'),
      userMsg('u2'),
      assistantMsg('a2', 'loading'),
    ];
    expect(pickCurrentMode(conv)).toBe('strict');
  });

  it('skips over a trailing errored bubble too', () => {
    const conv = [
      assistantMsg('a1', 'sent', 'precise'),
      userMsg('u2'),
      assistantMsg('a2', 'error'),
    ];
    expect(pickCurrentMode(conv)).toBe('precise');
  });

  it('ignores assistant messages with no recorded mode (legacy stored chats)', () => {
    // Messages persisted before this PR landed have no
    // redactionMode field. Walk past them to a newer message that
    // does.
    const conv = [assistantMsg('a1', 'sent'), userMsg('u2'), assistantMsg('a2', 'sent', 'strict')];
    expect(pickCurrentMode(conv)).toBe('strict');
  });
});

import { describeReportDelete } from '../report-delete';

/**
 * 删除报告 must not claim more than the server said.
 *
 * The API answers a delete with `storageCleanupStatus`, and both delete
 * screens used to discard it and show「这份报告已移除」regardless. This
 * pins the one place that decides the wording: the patient is told the
 * file is gone only when the server said it is gone, and every other
 * value — including one this bundle has never heard of — is handled as
 * "not confirmed" rather than as success.
 */
describe('describeReportDelete', () => {
  it('claims erasure when the file was removed', () => {
    const outcome = describeReportDelete('removed');
    expect(outcome.fileErased).toBe(true);
    expect(outcome.tone).toBe('success');
    expect(outcome.message).toContain('已移除');
  });

  it('claims erasure when the file was already absent', () => {
    // 'missing' is the state the patient asked for, reached early.
    const outcome = describeReportDelete('missing');
    expect(outcome.fileErased).toBe(true);
    expect(outcome.message).toContain('已移除');
  });

  it('never says 已移除 when the cleanup failed', () => {
    const outcome = describeReportDelete('failed');
    expect(outcome.fileErased).toBe(false);
    expect(outcome.tone).toBe('error');
    expect(outcome.message).not.toContain('已移除');
    // It has to say both halves: the record went, the file did not.
    expect(outcome.message).toContain('记录已经删除');
    expect(outcome.message).toContain('没能清除');
  });

  it.each([[undefined], [null], [''], ['pending_retry']])(
    'treats %p as unconfirmed rather than as success',
    (status) => {
      const outcome = describeReportDelete(status as string | null | undefined);
      expect(outcome.fileErased).toBe(false);
      expect(outcome.message).not.toContain('已移除');
    },
  );
});

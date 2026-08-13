/**
 * What to tell a patient after 删除报告.
 *
 * Deleting a report is two operations that can disagree: the database
 * row and the stored scan. `DELETE /profiles/me/documents/:id` reports
 * the second one separately as `storageCleanupStatus`, and both delete
 * screens used to `await` the call, throw the result away, and say
 *「已删除 / 这份报告已移除」unconditionally. For a genetic or MRI report
 * that is the app telling someone their document is gone at the moment
 * the server said it could not remove it.
 *
 * The API no longer answers 200 for a file it failed to erase (see
 * profile.controller.ts#deleteDocument — it refuses the delete and
 * keeps the row, so the file stays reachable). This module is still
 * where the answer is decided, for two reasons: the web export and the
 * API deploy separately, so a current bundle can be talking to an API
 * container that still downgrades the failure to a 200; and a status
 * this app does not recognise must not be read as success either.
 *
 * Kept as a pure function so both screens reach the same words, and so
 * the wording can be tested without rendering either one.
 */

/** Mirrors the union in lib/api's `deletePatientDocument`. */
export type StorageCleanupStatus = 'removed' | 'missing' | 'failed';

export interface ReportDeleteOutcome {
  /** True only when the stored file is known to be gone — either the
   *  server erased it, or it was already absent. Anything else, the
   *  screen must not claim erasure. */
  fileErased: boolean;
  tone: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

export const describeReportDelete = (
  status: StorageCleanupStatus | string | null | undefined,
): ReportDeleteOutcome => {
  // 'missing' is a completed deletion, not a partial one: the object was
  // already absent, which is the state the patient asked for.
  if (status === 'removed' || status === 'missing') {
    return {
      fileErased: true,
      tone: 'success',
      title: '已删除',
      message: '这份报告已移除，相关汇总会按最新数据重新计算。',
    };
  }

  if (status === 'failed') {
    return {
      fileErased: false,
      tone: 'error',
      title: '记录已删除，文件还没删掉',
      // Says exactly what is true and what happens next. No 「已移除」,
      // and no invented promise of an automatic retry — nothing on the
      // server sweeps orphaned files today.
      message: '这份报告的记录已经删除，但服务器上的原件这次没能清除。请联系我们协助彻底删除。',
    };
  }

  // An unrecognised status — a field the server renamed, a proxy that
  // stripped it, a value added after this bundle shipped. The row is
  // gone (the call returned 200), the file's fate is unknown, and
  // "unknown" is not 「已移除」.
  return {
    fileErased: false,
    tone: 'info',
    title: '已删除',
    message: '这份报告的记录已经删除。服务器没有确认原件是否已清除。',
  };
};

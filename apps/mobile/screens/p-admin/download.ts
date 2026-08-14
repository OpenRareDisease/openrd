import { Platform } from 'react-native';
import type { AdminDownload } from '../../lib/admin-api';

/**
 * Handing a downloaded file to the browser.
 *
 * WHY THIS IS WEB-ONLY AND SAYS SO OUT LOUD.
 *
 * §C: apps/mobile ships as a web export read in WeChat's in-app
 * browser, so `document` and `URL.createObjectURL` are the platform.
 * The same gesture on the native shells has no equivalent — there is no
 * download folder to put a file in — so `isDownloadSupported` is
 * checked BEFORE the request goes out rather than after. That order is
 * the point: every export writes an audit row and the full one reads
 * every profile in the database, and doing that work to then discover
 * we cannot save the bytes would leave a trail of exports nobody ever
 * received. Same shape as `downloadJsonInBrowser` in p-settings, which
 * is the pattern this copies.
 */

export const isDownloadSupported = (): boolean =>
  Platform.OS === 'web' &&
  typeof document !== 'undefined' &&
  typeof URL !== 'undefined' &&
  typeof URL.createObjectURL === 'function';

export const DOWNLOAD_UNSUPPORTED_MESSAGE =
  '这个客户端不能保存文件。后台导出请在浏览器里打开（生产环境本来就是网页版），' +
  '换个环境再来——现在点下去只会写一条导出审计，拿不到文件。';

/**
 * Save a blob under a name.
 *
 * The name is the caller's decision and NOT defaulted here: when the
 * server's `Content-Disposition` could not be read (see
 * `AdminDownload.fileName`), the substitute has to be one the operator
 * was told about, not one this function invented behind them.
 */
export const saveBlobInBrowser = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/**
 * Which of the two exports is asking, because the two do not leave the
 * same trail and the fallback notice used to claim they did.
 *
 * `recordFullExportAudit` (apps/api/src/modules/admin/admin.service.ts)
 * is the ONLY writer that puts `fileName` in an audit payload, and it
 * is called only from `exportAllPatientsCsv`. The single-patient export
 * leaves `requireAdmin`'s row alone, whose payload is fixed at
 * `{adminUserId, targetUserId, path, method}`
 * (apps/api/src/middleware/require-admin.ts:281-286) — no file name in
 * it, and no second row either.
 */
export type AdminDownloadKind = 'full_export' | 'patient_export';

const FALLBACK_PREFIX =
  '浏览器没有把服务端给的文件名交给页面（跨域部署时会这样），所以这个文件用的是本机生成的名字，' +
  '里面没有服务端记录的操作者。';

const FALLBACK_NOTICE: Record<AdminDownloadKind, string> = {
  full_export:
    FALLBACK_PREFIX +
    '服务端那个名字写在这次全量导出单独记的那条 admin.export 审计记录里（payload 的 fileName）。',
  patient_export:
    FALLBACK_PREFIX +
    '这一次导出的服务端文件名没有留在任何地方：单个患者的导出只写一条 admin.export 审计记录，' +
    '里面是操作者、患者和时间，没有文件名。要把这个文件对回去，用那条记录的患者 ID 和时间。',
};

/**
 * The name we fall back to, and the sentence that goes with it.
 *
 * `fallbackName` carries a UTC stamp this client generated and NOTHING
 * about the operator, because this client does not know the operator's
 * `app_users.id` — the API does, and it is what the server's own name
 * carries. So the fallback is not a lookalike: it says in the name
 * itself that the server's name was not received, and the caller shows
 * `notice`. What the notice then tells the operator to look up depends
 * on which export this was — see `AdminDownloadKind`.
 */
export const describeDownloadName = (
  download: AdminDownload,
  fallbackName: string,
  kind: AdminDownloadKind,
): { fileName: string; notice: string | null } => {
  if (download.fileName) return { fileName: download.fileName, notice: null };
  return { fileName: fallbackName, notice: FALLBACK_NOTICE[kind] };
};

/** A UTC stamp in the same basic ISO 8601 form the server uses, so a
 *  fallback name still sorts next to the real ones. */
export const downloadStamp = (at: Date = new Date()): string =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

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
 * The name we fall back to, and the sentence that goes with it.
 *
 * `fallbackName` carries a UTC stamp this client generated and NOTHING
 * about the operator, because this client does not know the operator's
 * `app_users.id` — the API does, and it is what the server's own name
 * carries. So the fallback is not a lookalike: it says in the name
 * itself that the server's name was not received, and the caller shows
 * `notice`. The real name is still recoverable — it is in the second
 * `admin.export` audit row, which the server writes before it sends a
 * byte.
 */
export const describeDownloadName = (
  download: AdminDownload,
  fallbackName: string,
): { fileName: string; notice: string | null } => {
  if (download.fileName) return { fileName: download.fileName, notice: null };
  return {
    fileName: fallbackName,
    notice:
      '浏览器没有把服务端给的文件名交给页面（跨域部署时会这样），所以这个文件用的是本机生成的名字，' +
      '里面没有服务端记录的操作者。服务端那个名字写在这次导出的审计记录里。',
  };
};

/** A UTC stamp in the same basic ISO 8601 form the server uses, so a
 *  fallback name still sorts next to the real ones. */
export const downloadStamp = (at: Date = new Date()): string =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

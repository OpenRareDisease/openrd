/**
 * 预产期的存储 —— 这个功能唯一持有的状态。
 *
 * 三条规矩，按重要性排：不推断、一键删、删除本身不留痕。下面每一条都
 * 有一个会变红的断言，包括「这个模块不许 import lib/api」这一条 ——
 * 它读的是文件自己的源码，因为那是唯一能在未来某次重构里挡住这个值被
 * 顺手发出去的检查。
 */

import fs from 'fs';
import path from 'path';

const mockGetItem = jest.fn();
const mockSetItem = jest.fn();
const mockRemoveItem = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: unknown[]) => mockGetItem(...args),
    setItem: (...args: unknown[]) => mockSetItem(...args),
    removeItem: (...args: unknown[]) => mockRemoveItem(...args),
  },
}));

import {
  PREGNANCY_DUE_DATE_KEY,
  clearDueDate,
  readDueDate,
  saveDueDate,
} from '../pregnancy-tracker';
import { TERM_DAYS } from '../../../lib/pregnancy-timeline-content';

const TODAY = new Date(2026, 4, 20);

const isoOffsetFromToday = (days: number): string => {
  const date = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
};

beforeEach(() => {
  mockGetItem.mockReset().mockResolvedValue(null);
  mockSetItem.mockReset().mockResolvedValue(undefined);
  mockRemoveItem.mockReset().mockResolvedValue(undefined);
});

describe('默认是关的', () => {
  it('没有存过就返回 null', async () => {
    await expect(readDueDate(TODAY)).resolves.toBeNull();
  });

  it('存的是垃圾也返回 null，不猜', async () => {
    for (const junk of ['', 'yes', '2026/05/20', '{}', '2026-02-30']) {
      mockGetItem.mockResolvedValue(junk);
      await expect(readDueDate(TODAY)).resolves.toBeNull();
    }
  });

  it('读存储抛异常时返回 null —— 安全方向是沉默，不是猜一个周数', async () => {
    mockGetItem.mockRejectedValue(new Error('QuotaExceededError'));
    await expect(readDueDate(TODAY)).resolves.toBeNull();
  });
});

describe('过期的日期在读的时候就作废', () => {
  it('存进去时还有效，放到过了预产期再读，返回 null', async () => {
    // The case that actually happens: the date was valid when saved,
    // the app was closed for a month, the clock moved. Validating only
    // on write would leave a stale date to be rendered as a week
    // number on the next open — which is the exact thing this feature
    // must never do after a due date has passed.
    const due = isoOffsetFromToday(10);
    mockGetItem.mockResolvedValue(due);
    await expect(readDueDate(TODAY)).resolves.toBe(due);

    const later = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 11);
    await expect(readDueDate(later)).resolves.toBeNull();
  });
});

describe('写入只发生在一处，且只写一个键', () => {
  it('合法日期写进唯一的那个键', async () => {
    const due = isoOffsetFromToday(100);
    await expect(saveDueDate(due, TODAY)).resolves.toBe(true);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(PREGNANCY_DUE_DATE_KEY, due);
  });

  it('不合法的日期一个字节都不写', async () => {
    for (const bad of ['', 'abc', isoOffsetFromToday(-1), isoOffsetFromToday(TERM_DAYS + 1)]) {
      await expect(saveDueDate(bad, TODAY)).resolves.toBe(false);
    }
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('读取动作从不写入 —— 打开这一页什么都不会被记下来', async () => {
    // 「NEVER inferred」 in its most literal form: opening the screen
    // calls readDueDate and nothing else, and readDueDate must not
    // leave a trace that the page was opened.
    mockGetItem.mockResolvedValue(isoOffsetFromToday(50));
    await readDueDate(TODAY);
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('写存储失败时返回 false，不假装成功', async () => {
    mockSetItem.mockRejectedValue(new Error('storage full'));
    await expect(saveDueDate(isoOffsetFromToday(100), TODAY)).resolves.toBe(false);
  });
});

describe('一键删除', () => {
  it('删除就是删除那一个键，没有别的动作', async () => {
    await expect(clearDueDate()).resolves.toBe(true);
    expect(mockRemoveItem).toHaveBeenCalledTimes(1);
    expect(mockRemoveItem).toHaveBeenCalledWith(PREGNANCY_DUE_DATE_KEY);
  });

  it('删除不写任何「曾经开过 / 何时关掉」的痕迹', async () => {
    // Rule 3. A 「was tracking, stopped on 3 May」 flag would be a
    // pregnancy-outcome log by another name — exactly the category
    // PIPL Art. 28 names as risking discrimination in 就业、保险、婚育
    // — and would itself need somewhere to be deleted from.
    await clearDueDate();
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('存储删除失败也会 resolve —— 界面不许等它', async () => {
    // A person who pressed this has stopped consenting whether or not
    // the browser's storage cooperated. The screen clears its own
    // state synchronously; this must never throw and strand it.
    mockRemoveItem.mockRejectedValue(new Error('nope'));
    await expect(clearDueDate()).resolves.toBe(false);
  });
});

describe('这个值没有出去的路', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'pregnancy-tracker.ts'), 'utf8');

  it('模块不 import API 客户端', () => {
    // A source-level check on purpose. The promise made to the patient
    // in PREGNANCY_CONSENT_BODY is 「不会上传到服务器」, and the only
    // durable way to keep it is for there to be no client in scope
    // that a later edit could reach for. This assertion is what makes
    // that a guarantee instead of an intention.
    expect(source).not.toMatch(/from\s+['"].*lib\/api['"]/);
    expect(source).not.toMatch(/apiRequest|getMyPatientProfile|getClinicalPassport/);
  });

  it('模块里没有 fetch、没有 XHR、没有 WebSocket', () => {
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/XMLHttpRequest|WebSocket|sendBeacon/);
  });

  it('只用到一个存储键，而且那个键住在登出扫得到的地方', () => {
    // This used to scan the source for `openrd.` literals, which is
    // what it means when a check follows the text instead of the
    // property: the key then moved to lib/draft-keys.ts — where the
    // logout sweep list can see it, which is the whole point — and a
    // test named 「只用到一个存储键」 went red for a change that made
    // the key safer.
    //
    // The literal must NOT be here now. Declared beside its writer is
    // exactly how it survived logout on a phone shared between affected
    // family members, and in an autosomal dominant disease that phone
    // is the ordinary case.
    expect(source).not.toMatch(/['"]openrd\./);

    const storageCalls =
      source.match(
        /AsyncStorage\.(getItem|setItem|removeItem|multiRemove)\(\s*([A-Za-z_$][\w$]*)/g,
      ) ?? [];
    expect(storageCalls.length).toBeGreaterThan(0);
    storageCalls.forEach((call) => {
      expect(call).toContain('PREGNANCY_DUE_DATE_KEY');
    });
  });
});

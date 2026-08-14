/**
 * `describeAdminError` — the sentence an operator gets when something
 * goes wrong, and the reason it is one function rather than a `catch`
 * per screen.
 *
 * The bodies below are the ones this API actually sends. The 400 pair
 * is the one with history: for a ZodError, `error-handler.ts` sends
 * `flatten()` UNFILTERED (the CLIENT_SAFE_DETAIL_KEYS projection only
 * applies to `AppError.details`), so the per-field breakdown has been
 * on the wire the whole time and nothing read it — the operator saw
 * 「请求失败 / Validation failed」 and had twelve boxes to guess between.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
  multiRemove: () => Promise.resolve(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
  isAvailableAsync: () => Promise.resolve(false),
}));

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

import { ApiError } from '../../../lib/api';
import { describeAdminError, describeValidationDetails } from '../common';

const apiError = (message: string, status: number, data?: unknown) => {
  const error = new ApiError(message);
  error.status = status;
  error.data = data;
  return error;
};

describe('a zod 400 names where the server objected', () => {
  it('reads the flattened field errors the API already sends', () => {
    // What `PUT /admin/patients/:id/baseline` answers for a
    // `diseaseBackground.diagnosisType` over `nullableText(40)`. zod
    // keys `fieldErrors` by the FIRST path segment, so this is the
    // section rather than the box — which is still the difference
    // between one place to look and twelve.
    const described = describeAdminError(
      apiError('Validation failed', 400, {
        error: 'Validation failed',
        details: {
          formErrors: [],
          fieldErrors: {
            diseaseBackground: ['String must contain at most 40 character(s)'],
          },
        },
      }),
    );
    expect(described.message).toContain('diseaseBackground');
    expect(described.message).toContain('at most 40 character(s)');
  });

  it('says the server said nothing more when it really did not', () => {
    const described = describeAdminError(apiError('Validation failed', 400));
    expect(described.message).toContain('服务端没有说是哪个字段');
  });

  it('passes through the sentence requireAdmin writes for a mistyped id', () => {
    // Not a zod refusal: `requireAdmin` answers a non-UUID
    // `targetParam` with a Chinese sentence that says what to do. It
    // must not be buried under a paragraph about length limits.
    const described = describeAdminError(
      apiError('链接里的患者 ID 不是一个合法的用户 ID，请从患者列表里再点一次。', 400),
    );
    expect(described.message).toContain('请从患者列表里再点一次');
    expect(described.message).not.toContain('长度上限');
  });

  it('returns null for a body with no breakdown in it', () => {
    expect(describeValidationDetails(null)).toBeNull();
    expect(describeValidationDetails({ error: 'Validation failed' })).toBeNull();
    expect(describeValidationDetails({ details: { formErrors: [], fieldErrors: {} } })).toBeNull();
  });
});

describe('the other statuses this router produces', () => {
  it('says a 409 changed nothing', () => {
    const described = describeAdminError(
      apiError('患者数量在你确认之后发生了变化（确认时 35 位，现在 36 位），请重新确认。', 409),
    );
    expect(described.title).toBe('数据在你操作期间变了');
    expect(described.message).toContain('什么都没有导出');
  });

  it('carries the retry window of a 429 rather than 「过于频繁」 alone', () => {
    const throttled = apiError('全量导出过于频繁，请稍后再试', 429);
    throttled.retryAfterSeconds = 42;
    expect(describeAdminError(throttled).message).toContain('42 秒');
  });

  it('does not invent a countdown when the server did not send one', () => {
    expect(describeAdminError(apiError('全量导出过于频繁，请稍后再试', 429)).message).toBe(
      '全量导出过于频繁，请稍后再试',
    );
  });

  it('keeps 403 pointing at the shell, not at the app', () => {
    // There is no self-service path to this role — §B1. A 403 that read
    // 「请联系管理员开通」 would send an operator looking for a button
    // that does not exist.
    const described = describeAdminError(apiError('Forbidden', 403));
    expect(described.message).toContain('admin:grant');
    expect(described.message).toContain('App 里没有自助入口');
  });
});

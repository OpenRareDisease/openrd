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
  /**
   * Every 409 this router produces, copied out of admin.controller.ts.
   * Only the FIRST is 「数据在你操作期间变了」 and only the first is fixed
   * by retrying — the second says to use another tool, the third says
   * the patient has to act, the fourth says to report a bug — so nothing
   * may be appended to any of them.
   */
  const CONFLICTS = [
    '患者数量在你确认之后发生了变化（确认时 35 位，现在 36 位），请重新确认。',
    '本次导出涉及 40001 位患者，超过单次上限 40000。这个接口不会输出截断的文件，请改用 npm run db:backup。',
    '这个账号注册后还没有建过健康档案，后台不能替他建。请让患者本人在 App 里先保存一次基线，或者确认这个用户 ID 是不是拿错了。',
    '这份档案里有 1 个字段是管理员代填的（foundation.fullName），但这次生成的 fhir-r4 文档里没有出现来源标记，' +
      '发出去会被当成患者自述。已拒绝导出，请把这个情况报给维护者。这些字段的来源可以在后台的患者档案页上逐条看到。',
    '这份档案里有 1 个字段的来源记录读不出来（foundation.fullName），只能确定不是患者本人填写；' +
      '但这次生成的 fhir-r4 文档里没有写明这一点，发出去会被当成患者自述。已拒绝导出，请把这个情况报给维护者。' +
      '这些字段的来源可以在后台的患者档案页上逐条看到。',
  ];

  it('hands a 409 to the operator exactly as the server wrote it', () => {
    for (const message of CONFLICTS) {
      const described = describeAdminError(apiError(message, 409));
      expect(described.message).toBe(message);
    }
  });

  it('does not tell an operator to retry a 409 nothing will change', () => {
    // 「重新来一遍即可」 on the no-profile refusal produces the identical
    // 409 forever, and on the marker refusal it contradicts the
    // server's own 「请把这个情况报给维护者」 in the same paragraph.
    for (const message of CONFLICTS) {
      const described = describeAdminError(apiError(message, 409));
      expect(described.message).not.toContain('重新来一遍');
      expect(described.title).not.toContain('数据在你操作期间变了');
    }
  });

  it('carries the retry window of a 429 rather than 「过于频繁」 alone', () => {
    // This one hand-sets the field because it is a test of the wording.
    // That the field is POPULATED at all on the only 429 this router
    // has — the full export's limiter, which goes through
    // `adminFetchFile`, not `apiRequest` — is pinned in
    // lib/__tests__/admin-api.test.ts through a stubbed fetch.
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

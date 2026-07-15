/**
 * Shared form-validation helpers for the auth / profile forms.
 *
 * PASSWORD_MIN_LENGTH must stay in sync with the backend's
 * `auth.schema.ts` (`z.string().min(8)`); PASSWORD_MAX_LENGTH mirrors
 * the register inputs' `maxLength={20}`. Every user-facing password
 * string derives from these constants — the register screen used to
 * hard-code "6-20位" in a placeholder while its validator required
 * >= 8, so following the placeholder got users rejected.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 20;

export const isValidChinaMobile = (phone: string): boolean => /^1[3-9]\d{9}$/.test(phone);

export const isValidPassword = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;

export const isValidDateString = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export const isValidYear = (value: string): boolean => /^\d{4}$/.test(value);

/**
 * Register-form fields that can fail validation, in visual
 * (top-to-bottom) order. `firstRegisterError` walks this list so the
 * screen scrolls to the highest failing field, not an arbitrary one.
 *
 * Registration is deliberately just the ACCOUNT essentials — the
 * medical profile (name, birth, region, FSHD background) moved to
 * the onboarding gate's dedicated setup screen, which has drafts,
 * retries, and a minimal required set of its own.
 */
export const REGISTER_FIELD_ORDER = [
  'identity',
  'phone',
  'code',
  'password',
  'confirmPassword',
] as const;

export type RegisterField = (typeof REGISTER_FIELD_ORDER)[number];
export type RegisterErrors = Partial<Record<RegisterField, string>>;

export interface RegisterValidationInput {
  identity: string;
  phone: string;
  code: string;
  password: string;
  confirmPassword: string;
}

/**
 * Pure validator returning EVERY failing field at once, so the form
 * can render inline per-field errors instead of surfacing one
 * blocking modal per issue and forcing a fix-resubmit loop.
 */
export const validateRegisterForm = (input: RegisterValidationInput): RegisterErrors => {
  const errors: RegisterErrors = {};

  if (!input.identity) {
    errors.identity = '请选择身份';
  }
  if (!input.phone) {
    errors.phone = '请输入手机号';
  } else if (!isValidChinaMobile(input.phone)) {
    errors.phone = '请输入正确的手机号';
  }
  if (!input.code) {
    errors.code = '请输入验证码';
  }
  if (!input.password) {
    errors.password = '请设置密码';
  } else if (!isValidPassword(input.password)) {
    errors.password = `密码长度应为${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位`;
  }
  if (input.password !== input.confirmPassword) {
    errors.confirmPassword = '两次输入的密码不一致';
  }

  return errors;
};

export const firstRegisterError = (errors: RegisterErrors): RegisterField | null => {
  for (const field of REGISTER_FIELD_ORDER) {
    if (errors[field]) {
      return field;
    }
  }
  return null;
};

export type LoginField = 'phone' | 'password';
export type LoginErrors = Partial<Record<LoginField, string>>;

export interface LoginValidationInput {
  phone: string;
  password: string;
}

export const validateLoginForm = (input: LoginValidationInput): LoginErrors => {
  const errors: LoginErrors = {};

  if (!input.phone) {
    errors.phone = '请输入手机号';
  } else if (!isValidChinaMobile(input.phone)) {
    errors.phone = '请输入正确的手机号';
  }
  if (!input.password) {
    errors.password = '请输入密码';
  }

  return errors;
};

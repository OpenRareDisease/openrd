import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  REGISTER_FIELD_ORDER,
  type RegisterValidationInput,
  firstRegisterError,
  validateLoginForm,
  validateRegisterForm,
} from '../validation';

const validRegisterInput: RegisterValidationInput = {
  identity: 'patient_family',
  fullName: '张三',
  dateOfBirth: '1990-05-20',
  gender: 'male',
  diagnosisYear: '2022',
  phone: '13800000000',
  code: '123456',
  password: 'abcd1234',
  confirmPassword: 'abcd1234',
  contactEmail: 'user@example.com',
  regionProvince: '广东省',
  regionCity: '深圳市',
  regionDistrict: '南山区',
};

describe('validateRegisterForm', () => {
  it('returns no errors for a fully valid form', () => {
    expect(validateRegisterForm(validRegisterInput)).toEqual({});
  });

  it('collects EVERY failing field at once (not just the first)', () => {
    const errors = validateRegisterForm({
      identity: '',
      fullName: '  ',
      dateOfBirth: '',
      gender: '',
      diagnosisYear: '',
      phone: '',
      code: '',
      password: '',
      confirmPassword: '',
      contactEmail: '',
      regionProvince: '',
      regionCity: '',
      regionDistrict: '',
    });

    // Every required field reports simultaneously — this is the
    // contract the inline-error UX depends on (the old flow showed
    // one blocking modal per field per submit).
    expect(Object.keys(errors).sort()).toEqual(
      [
        'identity',
        'fullName',
        'dateOfBirth',
        'gender',
        'phone',
        'code',
        'password',
        'regionProvince',
        'regionCity',
        'regionDistrict',
      ].sort(),
    );
  });

  it('enforces the shared password policy and message', () => {
    const short = validateRegisterForm({
      ...validRegisterInput,
      password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
      confirmPassword: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
    });
    expect(short.password).toBe(`密码长度应为${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位`);

    const long = validateRegisterForm({
      ...validRegisterInput,
      password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1),
      confirmPassword: 'a'.repeat(PASSWORD_MAX_LENGTH + 1),
    });
    expect(long.password).toBeDefined();

    const minBoundary = validateRegisterForm({
      ...validRegisterInput,
      password: 'a'.repeat(PASSWORD_MIN_LENGTH),
      confirmPassword: 'a'.repeat(PASSWORD_MIN_LENGTH),
    });
    expect(minBoundary.password).toBeUndefined();
  });

  it('flags mismatched password confirmation', () => {
    const errors = validateRegisterForm({
      ...validRegisterInput,
      confirmPassword: 'different1',
    });
    expect(errors.confirmPassword).toBe('两次输入的密码不一致');
  });

  it('rejects malformed phone numbers', () => {
    expect(validateRegisterForm({ ...validRegisterInput, phone: '12345' }).phone).toBe(
      '请输入正确的手机号',
    );
    expect(validateRegisterForm({ ...validRegisterInput, phone: '23800000000' }).phone).toBe(
      '请输入正确的手机号',
    );
  });

  it('rejects an incomplete or impossible date of birth', () => {
    expect(validateRegisterForm({ ...validRegisterInput, dateOfBirth: '' }).dateOfBirth).toBe(
      '请选择出生日期',
    );
    expect(
      validateRegisterForm({ ...validRegisterInput, dateOfBirth: '1990-5-2' }).dateOfBirth,
    ).toBe('请选择完整有效的出生日期');
  });

  it('treats email and diagnosis year as optional but validates them when present', () => {
    const empty = validateRegisterForm({
      ...validRegisterInput,
      contactEmail: '',
      diagnosisYear: '',
    });
    expect(empty.contactEmail).toBeUndefined();
    expect(empty.diagnosisYear).toBeUndefined();

    const bad = validateRegisterForm({
      ...validRegisterInput,
      contactEmail: 'not-an-email',
      diagnosisYear: '22',
    });
    expect(bad.contactEmail).toBe('请输入正确的邮箱格式');
    expect(bad.diagnosisYear).toBe('确诊年份请填写 4 位年份');
  });
});

describe('firstRegisterError', () => {
  it('returns the highest field on screen, following REGISTER_FIELD_ORDER', () => {
    const errors = validateRegisterForm({
      ...validRegisterInput,
      gender: '',
      regionDistrict: '',
    });
    // gender precedes regionDistrict in the visual order, so the
    // scroll-to-first-error helper must pick it.
    expect(firstRegisterError(errors)).toBe('gender');
  });

  it('returns null when there are no errors', () => {
    expect(firstRegisterError({})).toBeNull();
  });

  it('covers every field the validator can emit', () => {
    // Guard against adding a new validated field without slotting it
    // into the visual order (which would break scroll-to-error).
    const allFailing = validateRegisterForm({
      identity: '',
      fullName: '',
      dateOfBirth: 'bogus',
      gender: '',
      diagnosisYear: 'x',
      phone: 'x',
      code: '',
      password: 'x',
      confirmPassword: 'y',
      contactEmail: 'x',
      regionProvince: '',
      regionCity: '',
      regionDistrict: '',
    });
    for (const field of Object.keys(allFailing)) {
      expect(REGISTER_FIELD_ORDER).toContain(field);
    }
  });
});

describe('validateLoginForm', () => {
  it('passes a valid login form', () => {
    expect(validateLoginForm({ phone: '13800000000', password: 'x' })).toEqual({});
  });

  it('reports both fields at once when both are empty', () => {
    expect(validateLoginForm({ phone: '', password: '' })).toEqual({
      phone: '请输入手机号',
      password: '请输入密码',
    });
  });

  it('rejects a malformed phone', () => {
    expect(validateLoginForm({ phone: '138', password: 'x' }).phone).toBe('请输入正确的手机号');
  });
});

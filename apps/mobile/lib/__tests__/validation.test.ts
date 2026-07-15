import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  REGISTER_FIELD_ORDER,
  type RegisterValidationInput,
  firstRegisterError,
  validateLoginForm,
  validateRegisterForm,
} from '../validation';

const validInput: RegisterValidationInput = {
  identity: 'patient_family',
  phone: '13800000000',
  code: '123456',
  password: 'password123',
  confirmPassword: 'password123',
};

describe('validateRegisterForm (account essentials only)', () => {
  it('passes a fully valid form with zero errors', () => {
    expect(validateRegisterForm(validInput)).toEqual({});
  });

  it('collects EVERY failing field at once (no fix-resubmit loop)', () => {
    const errors = validateRegisterForm({
      identity: '',
      phone: '',
      code: '',
      password: '',
      confirmPassword: 'x',
    });
    expect(Object.keys(errors).sort()).toEqual(
      ['identity', 'phone', 'code', 'password', 'confirmPassword'].sort(),
    );
  });

  it('rejects malformed CN mobile numbers', () => {
    expect(validateRegisterForm({ ...validInput, phone: '12345' }).phone).toBe(
      '请输入正确的手机号',
    );
    expect(validateRegisterForm({ ...validInput, phone: '23800000000' }).phone).toBe(
      '请输入正确的手机号',
    );
  });

  it('enforces the single-source password policy at both boundaries', () => {
    const tooShort = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
    const minOk = 'a'.repeat(PASSWORD_MIN_LENGTH);
    const maxOk = 'a'.repeat(PASSWORD_MAX_LENGTH);
    const tooLong = 'a'.repeat(PASSWORD_MAX_LENGTH + 1);

    expect(
      validateRegisterForm({ ...validInput, password: tooShort, confirmPassword: tooShort })
        .password,
    ).toBe(`密码长度应为${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位`);
    expect(
      validateRegisterForm({ ...validInput, password: minOk, confirmPassword: minOk }).password,
    ).toBeUndefined();
    expect(
      validateRegisterForm({ ...validInput, password: maxOk, confirmPassword: maxOk }).password,
    ).toBeUndefined();
    expect(
      validateRegisterForm({ ...validInput, password: tooLong, confirmPassword: tooLong }).password,
    ).toBe(`密码长度应为${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH}位`);
  });

  it('flags a confirm-password mismatch', () => {
    expect(
      validateRegisterForm({ ...validInput, confirmPassword: 'different1' }).confirmPassword,
    ).toBe('两次输入的密码不一致');
  });

  it('every emittable error key appears in the visual scroll order', () => {
    const errors = validateRegisterForm({
      identity: '',
      phone: 'bad',
      code: '',
      password: 'x',
      confirmPassword: 'y',
    });
    for (const key of Object.keys(errors)) {
      expect(REGISTER_FIELD_ORDER).toContain(key);
    }
  });

  it('firstRegisterError follows the visual order', () => {
    expect(firstRegisterError({ confirmPassword: 'x', phone: 'y' })).toBe('phone');
    expect(firstRegisterError({})).toBeNull();
  });
});

describe('validateLoginForm', () => {
  it('passes a valid login', () => {
    expect(validateLoginForm({ phone: '13800000000', password: 'password123' })).toEqual({});
  });

  it('requires both fields and a well-formed phone', () => {
    expect(validateLoginForm({ phone: '', password: '' })).toEqual({
      phone: '请输入手机号',
      password: '请输入密码',
    });
    expect(validateLoginForm({ phone: '123', password: 'x' }).phone).toBe('请输入正确的手机号');
  });
});

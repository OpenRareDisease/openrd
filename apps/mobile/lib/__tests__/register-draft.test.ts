import {
  PATIENT_SCOPED_SECURE_KEYS,
  REGISTER_FORM_DRAFT_KEY,
  REGISTER_FORM_DRAFT_MAX_AGE_MS,
} from '../draft-keys';
import { parseRegisterDraft } from '../register-draft';

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const within = { now: NOW, maxAgeMs: REGISTER_FORM_DRAFT_MAX_AGE_MS };

const draft = (extra: Record<string, unknown>) => JSON.stringify(extra);

describe('parseRegisterDraft', () => {
  it('restores a draft saved inside the window', () => {
    const raw = draft({ phone: '13800138000', identity: 'patient_family', savedAt: NOW - 60_000 });
    expect(parseRegisterDraft(raw, within)).toEqual({
      phone: '13800138000',
      identity: 'patient_family',
      savedAt: NOW - 60_000,
    });
  });

  it('refuses a draft older than the window', () => {
    // The reported sequence: family member A types a number and gives
    // up, B opens the app days later. Before the window existed, B was
    // shown A's number.
    const raw = draft({
      phone: '13800138000',
      identity: 'patient_family',
      savedAt: NOW - REGISTER_FORM_DRAFT_MAX_AGE_MS - 1,
    });
    expect(parseRegisterDraft(raw, within)).toBeNull();
  });

  it('keeps a draft saved exactly at the window edge', () => {
    const raw = draft({ phone: '13800138000', savedAt: NOW - REGISTER_FORM_DRAFT_MAX_AGE_MS });
    expect(parseRegisterDraft(raw, within)?.phone).toBe('13800138000');
  });

  it('treats a draft with no savedAt as expired, not as fresh', () => {
    // Written by a build from before the bound existed — i.e. exactly
    // the devices already carrying an unbounded number. Grandfathering
    // them in would mean the fix never reaches the leak it was written
    // for.
    const raw = draft({ phone: '13800138000', identity: 'doctor' });
    expect(parseRegisterDraft(raw, within)).toBeNull();
  });

  it('ignores a non-numeric savedAt rather than coercing it', () => {
    const raw = draft({ phone: '13800138000', savedAt: '1753963200000' });
    expect(parseRegisterDraft(raw, within)).toBeNull();
  });

  it('drops unknown fields from a pre-slim draft instead of carrying them forward', () => {
    const raw = draft({
      phone: '13800138000',
      identity: 'other',
      fullName: '张三',
      region: '广东省',
      savedAt: NOW,
    });
    const parsed = parseRegisterDraft(raw, within);
    expect(parsed).toEqual({ phone: '13800138000', identity: 'other', savedAt: NOW });
    expect(parsed).not.toHaveProperty('fullName');
    expect(parsed).not.toHaveProperty('region');
  });

  it('rejects an identity outside the three known values', () => {
    const raw = draft({ phone: '13800138000', identity: 'admin', savedAt: NOW });
    expect(parseRegisterDraft(raw, within)?.identity).toBeNull();
  });

  it('returns null for a draft with no phone, so no key is kept alive for an enum', () => {
    expect(
      parseRegisterDraft(draft({ phone: '', identity: 'doctor', savedAt: NOW }), within),
    ).toBeNull();
    expect(parseRegisterDraft(draft({ phone: '   ', savedAt: NOW }), within)).toBeNull();
    expect(parseRegisterDraft(draft({ identity: 'doctor', savedAt: NOW }), within)).toBeNull();
  });

  it('never throws on garbage, so a broken draft cannot block registration', () => {
    expect(parseRegisterDraft(null, within)).toBeNull();
    expect(parseRegisterDraft('', within)).toBeNull();
    expect(parseRegisterDraft('not json', within)).toBeNull();
    expect(parseRegisterDraft('null', within)).toBeNull();
    expect(parseRegisterDraft('"13800138000"', within)).toBeNull();
    expect(parseRegisterDraft('[1,2,3]', within)).toBeNull();
  });

  it('never returns a secret, because none is ever persisted', () => {
    const raw = draft({
      phone: '13800138000',
      password: 'hunter2',
      code: '123456',
      otpRequestId: 'req_1',
      savedAt: NOW,
    });
    const parsed = parseRegisterDraft(raw, within);
    expect(Object.keys(parsed ?? {}).sort()).toEqual(['identity', 'phone', 'savedAt']);
  });
});

describe('REGISTER_FORM_DRAFT_KEY', () => {
  it('is in the list logout sweeps', () => {
    // It used to be declared privately inside p-login_register, so it
    // was in neither of the two lists anything clears.
    expect(PATIENT_SCOPED_SECURE_KEYS).toContain(REGISTER_FORM_DRAFT_KEY);
  });

  it('bounds an abandoned registration to a day', () => {
    expect(REGISTER_FORM_DRAFT_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

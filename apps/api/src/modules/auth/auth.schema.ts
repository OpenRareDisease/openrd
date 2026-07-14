import { z } from 'zod';

// Public registration is for patients and their caregivers. Clinician
// accounts are provisioned through an admin/back-office path that
// verifies licence credentials — letting the public form self-assign
// `clinician` would hand any registrant the elevated role's permission
// matrix without any verification step.
export const registerSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  otpCode: z.string().min(4, 'OTP code is required'),
  otpRequestId: z.string().optional(),
  password: z.string().min(8, 'Password must contain at least 8 characters'),
  email: z.string().email().optional(),
  role: z.enum(['patient', 'caregiver']).default('patient'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    phoneNumber: z.string().min(5).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8),
  })
  .refine((value) => value.phoneNumber || value.email, {
    message: 'Either phoneNumber or email is required',
    path: ['phoneNumber'],
  });

export type LoginInput = z.infer<typeof loginSchema>;

export const sendOtpSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  scene: z.enum(['register', 'login', 'reset']).default('register'),
});

export type SendOtpInput = z.infer<typeof sendOtpSchema>;

export const verifyOtpSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  code: z.string().min(4, 'OTP code is required'),
  scene: z.enum(['register', 'login', 'reset']).default('register'),
  requestId: z.string().optional(),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/** Passwordless login: a fresh OTP (scene 'login') IS the credential. */
export const otpLoginSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  code: z.string().min(4, 'OTP code is required'),
  requestId: z.string().optional(),
});

export type OtpLoginInput = z.infer<typeof otpLoginSchema>;

/** Self-service password reset, authorized by an OTP (scene 'reset').
 *  min(8) mirrors registerSchema's password policy. */
export const passwordResetSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  code: z.string().min(4, 'OTP code is required'),
  requestId: z.string().optional(),
  newPassword: z.string().min(8, 'Password must contain at least 8 characters'),
});

export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

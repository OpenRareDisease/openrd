import { z } from 'zod';

export const registerSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  password: z.string().min(8, 'Password must contain at least 8 characters'),
  email: z.string().email().optional(),
  role: z.enum(['patient', 'caregiver', 'clinician']).default('patient')
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    phoneNumber: z.string().min(5).optional(),
    email: z.string().email().optional(),
    password: z.string().min(8)
  })
  .refine((value) => value.phoneNumber || value.email, {
    message: 'Either phoneNumber or email is required',
    path: ['phoneNumber']
  });

export type LoginInput = z.infer<typeof loginSchema>;

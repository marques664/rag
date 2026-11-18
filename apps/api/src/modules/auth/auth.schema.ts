import { z } from 'zod';

export const registerBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});

export const loginBodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.string(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.string(),
});

export const authResponseSchema = z.object({
  user: publicUserSchema,
  tokens: authTokensSchema,
});

export const refreshResponseSchema = z.object({
  tokens: authTokensSchema,
});

export const logoutResponseSchema = z.object({
  success: z.literal(true),
});

export const currentUserResponseSchema = z.object({
  user: publicUserSchema,
  organizations: z.array(
    z.object({
      organizationId: z.string().uuid(),
      name: z.string(),
      slug: z.string(),
      role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
    }),
  ),
});

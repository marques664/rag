import { z } from 'zod';

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const organizationParamsSchema = z.object({
  id: z.string().uuid(),
});

export const memberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export const invitationParamsSchema = z.object({
  invitationId: z.string().uuid(),
});

export const createOrganizationBodySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(80)
    .regex(slugRegex, 'Slug must contain lowercase letters, numbers, and hyphens')
    .optional(),
});

export const updateOrganizationBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(80)
      .regex(
        slugRegex,
        'Slug must contain lowercase letters, numbers, and hyphens',
      )
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.slug !== undefined, {
    message: 'At least one field (name or slug) must be provided',
  });

export const createInvitationBodySchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

export const updateMemberRoleBodySchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
});

export const organizationSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const organizationListResponseSchema = z.object({
  organizations: z.array(organizationSummarySchema),
});

export const organizationResponseSchema = z.object({
  organization: organizationSummarySchema,
});

export const organizationMemberSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  joinedAt: z.string(),
});

export const organizationMembersResponseSchema = z.object({
  members: z.array(organizationMemberSchema),
});

export const invitationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER']),
  status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED']),
  expiresAt: z.string(),
  createdAt: z.string(),
});

export const invitationResponseSchema = z.object({
  invitation: invitationSchema,
});

export const invitationListResponseSchema = z.object({
  invitations: z.array(invitationSchema),
});

export const acceptInvitationResponseSchema = z.object({
  organization: organizationSummarySchema,
});

export const memberResponseSchema = z.object({
  member: organizationMemberSchema,
});

import type { InvitationStatus, MembershipRole } from '@enterprise-ai/database';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: MembershipRole;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  userId: string;
  name: string;
  email: string;
  role: MembershipRole;
  joinedAt: string;
}

export interface OrganizationInvitationDto {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: MembershipRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
}

export interface CreateInvitationInput {
  email: string;
  role: 'ADMIN' | 'MEMBER';
}

export interface UpdateMemberRoleInput {
  role: MembershipRole;
}

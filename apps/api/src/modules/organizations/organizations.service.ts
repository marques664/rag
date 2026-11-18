import { randomBytes } from 'node:crypto';
import {
  InvitationStatus,
  MembershipRole,
  Prisma,
} from '@enterprise-ai/database';
import { assertRequiredRole } from '../../middleware/rbac.js';
import { ForbiddenError } from '../../shared/errors/app-error.js';
import {
  AlreadyOrganizationMemberError,
  InvitationExpiredError,
  InvitationNotFoundError,
  InvitationNotPendingError,
  LastOwnerDemotionError,
  MemberNotFoundError,
  OrganizationAccessDeniedError,
  OrganizationSlugConflictError,
} from './organizations.errors.js';
import type {
  InvitationWithOrganization,
  MemberRecord,
  OrganizationWithRoleRecord,
  OrganizationsRepository,
} from './organizations.repository.js';
import type {
  CreateInvitationInput,
  CreateOrganizationInput,
  OrganizationInvitationDto,
  OrganizationMember,
  OrganizationSummary,
  UpdateMemberRoleInput,
  UpdateOrganizationInput,
} from './organizations.types.js';

const INVITATION_EXPIRY_DAYS = 7;

function slugify(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return base.length >= 2 ? base.slice(0, 72) : 'org';
}

function toOrganizationSummary(
  record: OrganizationWithRoleRecord,
): OrganizationSummary {
  return {
    id: record.organization.id,
    name: record.organization.name,
    slug: record.organization.slug,
    role: record.role,
    createdAt: record.organization.createdAt.toISOString(),
    updatedAt: record.organization.updatedAt.toISOString(),
  };
}

function toMemberDto(record: MemberRecord): OrganizationMember {
  return {
    userId: record.userId,
    name: record.user.name,
    email: record.user.email,
    role: record.role,
    joinedAt: record.createdAt.toISOString(),
  };
}

function toInvitationDto(
  record: InvitationWithOrganization,
): OrganizationInvitationDto {
  return {
    id: record.id,
    organizationId: record.organizationId,
    organizationName: record.organization.name,
    email: record.email,
    role: record.role,
    status: record.status,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

export class OrganizationsService {
  constructor(private readonly repository: OrganizationsRepository) {}

  private async resolveUniqueSlug(
    name: string,
    explicitSlug?: string,
  ): Promise<string> {
    if (explicitSlug) {
      const existing = await this.repository.findBySlug(explicitSlug);
      if (existing) {
        throw new OrganizationSlugConflictError();
      }
      return explicitSlug;
    }

    const baseSlug = slugify(name);
    const existing = await this.repository.findBySlug(baseSlug);
    if (!existing) {
      return baseSlug;
    }

    return `${baseSlug}-${randomBytes(3).toString('hex')}`;
  }

  private async requireMembership(
    organizationId: string,
    userId: string,
    minimumRole: MembershipRole = MembershipRole.MEMBER,
  ): Promise<OrganizationWithRoleRecord> {
    const membership = await this.repository.findForMember(
      organizationId,
      userId,
    );

    if (!membership) {
      throw new OrganizationAccessDeniedError();
    }

    assertRequiredRole(membership.role, minimumRole);
    return membership;
  }

  async createOrganization(
    userId: string,
    input: CreateOrganizationInput,
  ): Promise<OrganizationSummary> {
    const slug = await this.resolveUniqueSlug(input.name, input.slug);

    try {
      const created = await this.repository.createWithOwner({
        name: input.name.trim(),
        slug,
        ownerUserId: userId,
      });

      return toOrganizationSummary(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new OrganizationSlugConflictError();
      }
      throw error;
    }
  }

  async listOrganizations(userId: string): Promise<OrganizationSummary[]> {
    const records = await this.repository.listForUser(userId);
    return records.map(toOrganizationSummary);
  }

  async getOrganization(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationSummary> {
    const record = await this.requireMembership(
      organizationId,
      userId,
      MembershipRole.MEMBER,
    );
    return toOrganizationSummary(record);
  }

  async updateOrganization(
    organizationId: string,
    userId: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationSummary> {
    const current = await this.requireMembership(
      organizationId,
      userId,
      MembershipRole.ADMIN,
    );

    if (input.slug && input.slug !== current.organization.slug) {
      const slugOwner = await this.repository.findBySlug(input.slug);
      if (slugOwner) {
        throw new OrganizationSlugConflictError();
      }
    }

    try {
      const updated = await this.repository.updateById(organizationId, {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
      });

      return toOrganizationSummary({
        organization: updated,
        role: current.role,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new OrganizationSlugConflictError();
      }
      throw error;
    }
  }

  async listMembers(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationMember[]> {
    await this.requireMembership(organizationId, userId, MembershipRole.MEMBER);
    const members = await this.repository.listMembers(organizationId);
    return members.map(toMemberDto);
  }

  async createInvitation(
    organizationId: string,
    actorUserId: string,
    input: CreateInvitationInput,
  ): Promise<OrganizationInvitationDto> {
    const actor = await this.requireMembership(
      organizationId,
      actorUserId,
      MembershipRole.ADMIN,
    );

    // Only organization owners can invite admins.
    if (
      input.role === 'ADMIN' &&
      actor.role !== MembershipRole.OWNER
    ) {
      throw new ForbiddenError('Only organization owners can invite admins');
    }

    const normalizedEmail = input.email.trim().toLowerCase();
    const existingMember = await this.repository.findMemberByEmail(
      organizationId,
      normalizedEmail,
    );
    if (existingMember) {
      throw new AlreadyOrganizationMemberError();
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    const invitation = await this.repository.createInvitation({
      organizationId,
      email: normalizedEmail,
      role: input.role,
      invitedByUserId: actorUserId,
      expiresAt,
    });

    return toInvitationDto(invitation);
  }

  async listPendingInvitations(
    userEmail: string,
  ): Promise<OrganizationInvitationDto[]> {
    const invitations = await this.repository.listPendingInvitationsForEmail(
      userEmail.trim().toLowerCase(),
    );
    return invitations.map(toInvitationDto);
  }

  async acceptInvitation(
    invitationId: string,
    userId: string,
    userEmail: string,
  ): Promise<OrganizationSummary> {
    const invitation = await this.repository.findInvitationById(invitationId);
    if (!invitation) {
      throw new InvitationNotFoundError();
    }

    if (invitation.email !== userEmail.trim().toLowerCase()) {
      throw new ForbiddenError('This invitation belongs to another email address');
    }

    if (invitation.status !== InvitationStatus.PENDING) {
      throw new InvitationNotPendingError();
    }

    if (invitation.expiresAt <= new Date()) {
      throw new InvitationExpiredError();
    }

    const outcome = await this.repository.acceptInvitationTransaction({
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      userId,
      role: invitation.role,
    });

    if (outcome === 'not_pending') {
      throw new InvitationNotPendingError();
    }

    if (outcome === 'already_member') {
      throw new AlreadyOrganizationMemberError();
    }

    const membership = await this.repository.findForMember(
      invitation.organizationId,
      userId,
    );
    if (!membership) {
      throw new OrganizationAccessDeniedError();
    }

    return toOrganizationSummary(membership);
  }

  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
    input: UpdateMemberRoleInput,
  ): Promise<OrganizationMember> {
    await this.requireMembership(
      organizationId,
      actorUserId,
      MembershipRole.OWNER,
    );

    const result = await this.repository.updateMemberRoleTransaction({
      organizationId,
      targetUserId,
      newRole: input.role,
    });

    if (result.status === 'not_found') {
      throw new MemberNotFoundError();
    }

    if (result.status === 'last_owner') {
      throw new LastOwnerDemotionError();
    }

    return toMemberDto(result.member);
  }
}

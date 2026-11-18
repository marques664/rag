import {
  InvitationStatus,
  MembershipRole,
  type DatabaseClient,
  type Membership,
  type Organization,
  type OrganizationInvitation,
} from '@enterprise-ai/database';

export interface OrganizationWithRoleRecord {
  organization: Organization;
  role: MembershipRole;
}

export interface MemberRecord {
  userId: string;
  role: MembershipRole;
  createdAt: Date;
  user: {
    name: string;
    email: string;
  };
}

export type InvitationWithOrganization = OrganizationInvitation & {
  organization: Pick<Organization, 'id' | 'name' | 'slug'>;
};

/**
 * Tenant-aware repository for organizations, memberships, and invitations.
 * Every organization-scoped query filters directly by `organizationId` in PostgreSQL.
 */
export class OrganizationsRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findBySlug(slug: string): Promise<Organization | null> {
    return this.db.organization.findUnique({
      where: { slug },
    });
  }

  async createWithOwner(params: {
    name: string;
    slug: string;
    ownerUserId: string;
  }): Promise<OrganizationWithRoleRecord> {
    return this.db.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: params.name,
          slug: params.slug,
        },
      });

      const membership = await tx.membership.create({
        data: {
          organizationId: organization.id,
          userId: params.ownerUserId,
          role: MembershipRole.OWNER,
        },
      });

      return {
        organization,
        role: membership.role,
      };
    });
  }

  async listForUser(userId: string): Promise<OrganizationWithRoleRecord[]> {
    const memberships = await this.db.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        organization: true,
      },
    });

    return memberships.map((membership) => ({
      organization: membership.organization,
      role: membership.role,
    }));
  }

  async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null> {
    return this.db.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
    });
  }

  async findForMember(
    organizationId: string,
    userId: string,
  ): Promise<OrganizationWithRoleRecord | null> {
    const membership = await this.db.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId,
          userId,
        },
      },
      include: {
        organization: true,
      },
    });

    if (!membership) {
      return null;
    }

    return {
      organization: membership.organization,
      role: membership.role,
    };
  }

  async updateById(
    organizationId: string,
    data: { name?: string; slug?: string },
  ): Promise<Organization> {
    return this.db.organization.update({
      where: { id: organizationId },
      data,
    });
  }

  async listMembers(organizationId: string): Promise<MemberRecord[]> {
    return this.db.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        userId: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async findMemberByEmail(
    organizationId: string,
    email: string,
  ): Promise<Membership | null> {
    return this.db.membership.findFirst({
      where: {
        organizationId,
        user: {
          email,
        },
      },
    });
  }

  async createInvitation(params: {
    organizationId: string;
    email: string;
    role: MembershipRole;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<InvitationWithOrganization> {
    return this.db.organizationInvitation.create({
      data: {
        organizationId: params.organizationId,
        email: params.email,
        role: params.role,
        invitedByUserId: params.invitedByUserId,
        expiresAt: params.expiresAt,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async findInvitationById(
    invitationId: string,
  ): Promise<InvitationWithOrganization | null> {
    return this.db.organizationInvitation.findUnique({
      where: { id: invitationId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async listPendingInvitationsForEmail(
    email: string,
  ): Promise<InvitationWithOrganization[]> {
    return this.db.organizationInvitation.findMany({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async acceptInvitationTransaction(params: {
    invitationId: string;
    organizationId: string;
    userId: string;
    role: MembershipRole;
  }): Promise<'accepted' | 'not_pending' | 'already_member'> {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.organizationInvitation.updateMany({
        where: {
          id: params.invitationId,
          organizationId: params.organizationId,
          status: InvitationStatus.PENDING,
        },
        data: {
          status: InvitationStatus.ACCEPTED,
          acceptedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        return 'not_pending';
      }

      const existingMembership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: params.organizationId,
            userId: params.userId,
          },
        },
      });

      if (existingMembership) {
        return 'already_member';
      }

      await tx.membership.create({
        data: {
          organizationId: params.organizationId,
          userId: params.userId,
          role: params.role,
        },
      });

      return 'accepted';
    });
  }

  async updateMemberRoleTransaction(params: {
    organizationId: string;
    targetUserId: string;
    newRole: MembershipRole;
  }): Promise<
    | { status: 'updated'; member: MemberRecord }
    | { status: 'not_found' }
    | { status: 'last_owner' }
  > {
    return this.db.$transaction(async (tx) => {
      const target = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: params.organizationId,
            userId: params.targetUserId,
          },
        },
      });

      if (!target) {
        return { status: 'not_found' };
      }

      if (
        target.role === MembershipRole.OWNER &&
        params.newRole !== MembershipRole.OWNER
      ) {
        const ownerCount = await tx.membership.count({
          where: {
            organizationId: params.organizationId,
            role: MembershipRole.OWNER,
          },
        });

        if (ownerCount <= 1) {
          return { status: 'last_owner' };
        }
      }

      const updated = await tx.membership.update({
        where: {
          organizationId_userId: {
            organizationId: params.organizationId,
            userId: params.targetUserId,
          },
        },
        data: {
          role: params.newRole,
        },
        select: {
          userId: true,
          role: true,
          createdAt: true,
          user: {
            select: {
              name: true,
              email: true,
            },
          },
        },
      });

      return { status: 'updated', member: updated };
    });
  }
}

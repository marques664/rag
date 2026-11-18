import {
  type DatabaseClient,
  type MembershipRole,
  type Prisma,
  type RefreshToken,
  type User,
} from '@enterprise-ai/database';

export type DbExecutor = DatabaseClient | Prisma.TransactionClient;

export interface UserWithMemberships {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  memberships: Array<{
    role: MembershipRole;
    organization: {
      id: string;
      name: string;
      slug: string;
    };
  }>;
}

export interface CreateRefreshTokenRecordInput {
  id?: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

export class AuthRepository {
  constructor(private readonly db: DatabaseClient) {}

  async findUserByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { email },
    });
  }

  async findUserWithMembershipsById(
    userId: string,
  ): Promise<UserWithMemberships | null> {
    return this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            organization: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
  }

  async createUserWithRefreshToken(params: {
    user: { name: string; email: string; passwordHash: string };
    refreshToken: {
      tokenHash: string;
      familyId: string;
      expiresAt: Date;
    };
  }): Promise<{ user: User; refreshToken: RefreshToken }> {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: params.user.name,
          email: params.user.email,
          passwordHash: params.user.passwordHash,
        },
      });

      const refreshToken = await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: params.refreshToken.tokenHash,
          familyId: params.refreshToken.familyId,
          expiresAt: params.refreshToken.expiresAt,
        },
      });

      return { user, refreshToken };
    });
  }

  async createRefreshToken(
    input: CreateRefreshTokenRecordInput,
    executor: DbExecutor = this.db,
  ): Promise<RefreshToken> {
    return executor.refreshToken.create({
      data: {
        id: input.id,
        userId: input.userId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findRefreshTokenWithUserByHash(tokenHash: string): Promise<
    | (RefreshToken & {
        user: Pick<User, 'id' | 'email'>;
      })
    | null
  > {
    return this.db.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * Atomically revokes the current refresh token and creates its replacement.
   * Returns false if the token was already revoked concurrently.
   */
  async rotateRefreshToken(params: {
    currentTokenId: string;
    familyId: string;
    userId: string;
    newTokenId: string;
    newTokenHash: string;
    newExpiresAt: Date;
  }): Promise<boolean> {
    const now = new Date();

    return this.db.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: {
          id: params.currentTokenId,
          revokedAt: null,
        },
        data: {
          revokedAt: now,
          replacedByTokenId: params.newTokenId,
        },
      });

      if (revoked.count !== 1) {
        await tx.refreshToken.updateMany({
          where: {
            familyId: params.familyId,
            revokedAt: null,
          },
          data: {
            revokedAt: now,
          },
        });
        return false;
      }

      await tx.refreshToken.create({
        data: {
          id: params.newTokenId,
          userId: params.userId,
          tokenHash: params.newTokenHash,
          familyId: params.familyId,
          expiresAt: params.newExpiresAt,
        },
      });

      return true;
    });
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: {
        familyId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async revokeRefreshTokenByHash(
    tokenHash: string,
    userId?: string,
  ): Promise<void> {
    await this.db.refreshToken.updateMany({
      where: {
        tokenHash,
        revokedAt: null,
        ...(userId ? { userId } : {}),
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}

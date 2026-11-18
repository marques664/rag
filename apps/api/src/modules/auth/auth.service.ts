import { randomUUID } from 'node:crypto';
import { Prisma } from '@enterprise-ai/database';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { hashPassword, verifyPassword } from '../../shared/security/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from '../../shared/security/tokens.js';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from './auth.errors.js';
import type { AuthRepository } from './auth.repository.js';
import type {
  AuthResponse,
  AuthTokens,
  CurrentUserResponse,
  LoginInput,
  PublicUser,
  RefreshResponse,
  RegisterInput,
} from './auth.types.js';

// Precomputed valid scrypt hash used to keep login timing uniform when user email is absent.
const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$000102030405060708090a0b0c0d0e0f$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

export interface AuthServiceConfig {
  jwtSecret: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresDays: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toPublicUser(user: {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly config: AuthServiceConfig,
  ) {}

  private buildRefreshExpiry(): Date {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.config.refreshTokenExpiresDays);
    return expiresAt;
  }

  private async issueTokenPair(params: {
    userId: string;
    email: string;
    rawRefreshToken: string;
  }): Promise<AuthTokens> {
    const accessToken = await signAccessToken(
      { sub: params.userId, email: params.email },
      {
        secret: this.config.jwtSecret,
        expiresIn: this.config.accessTokenExpiresIn,
      },
    );

    return {
      accessToken,
      refreshToken: params.rawRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTokenExpiresIn,
    };
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const existing = await this.repository.findUserByEmail(email);
    if (existing) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await hashPassword(input.password);
    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const familyId = randomUUID();
    const expiresAt = this.buildRefreshExpiry();

    try {
      const { user } = await this.repository.createUserWithRefreshToken({
        user: {
          name: input.name.trim(),
          email,
          passwordHash,
        },
        refreshToken: {
          tokenHash,
          familyId,
          expiresAt,
        },
      });

      const tokens = await this.issueTokenPair({
        userId: user.id,
        email: user.email,
        rawRefreshToken,
      });

      return {
        user: toPublicUser(user),
        tokens,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const email = normalizeEmail(input.email);
    const user = await this.repository.findUserByEmail(email);

    if (!user) {
      await verifyPassword(input.password, DUMMY_PASSWORD_HASH);
      throw new InvalidCredentialsError();
    }

    const validPassword = await verifyPassword(input.password, user.passwordHash);
    if (!validPassword) {
      throw new InvalidCredentialsError();
    }

    const rawRefreshToken = generateRefreshToken();
    await this.repository.createRefreshToken({
      userId: user.id,
      tokenHash: hashRefreshToken(rawRefreshToken),
      familyId: randomUUID(),
      expiresAt: this.buildRefreshExpiry(),
    });

    const tokens = await this.issueTokenPair({
      userId: user.id,
      email: user.email,
      rawRefreshToken,
    });

    return {
      user: toPublicUser(user),
      tokens,
    };
  }

  async refresh(rawRefreshToken: string): Promise<RefreshResponse> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const existing =
      await this.repository.findRefreshTokenWithUserByHash(tokenHash);

    if (!existing) {
      throw new InvalidRefreshTokenError();
    }

    // Reusing an already rotated/revoked token indicates potential token theft.
    if (existing.revokedAt !== null) {
      await this.repository.revokeRefreshTokenFamily(existing.familyId);
      throw new InvalidRefreshTokenError(
        'Refresh token reuse detected; session revoked',
      );
    }

    if (existing.expiresAt <= new Date()) {
      await this.repository.revokeRefreshTokenByHash(tokenHash);
      throw new InvalidRefreshTokenError('Refresh token expired');
    }

    const nextRawRefreshToken = generateRefreshToken();
    const nextTokenId = randomUUID();
    const rotated = await this.repository.rotateRefreshToken({
      currentTokenId: existing.id,
      familyId: existing.familyId,
      userId: existing.userId,
      newTokenId: nextTokenId,
      newTokenHash: hashRefreshToken(nextRawRefreshToken),
      newExpiresAt: this.buildRefreshExpiry(),
    });

    if (!rotated) {
      throw new InvalidRefreshTokenError(
        'Refresh token reuse detected; session revoked',
      );
    }

    const tokens = await this.issueTokenPair({
      userId: existing.user.id,
      email: existing.user.email,
      rawRefreshToken: nextRawRefreshToken,
    });

    return { tokens };
  }

  async logout(rawRefreshToken: string, userId?: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawRefreshToken);
    await this.repository.revokeRefreshTokenByHash(tokenHash, userId);
  }

  async getCurrentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.repository.findUserWithMembershipsById(userId);
    if (!user) {
      throw new UnauthorizedError('User account no longer exists');
    }

    return {
      user: toPublicUser(user),
      organizations: user.memberships.map((membership) => ({
        organizationId: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        role: membership.role,
      })),
    };
  }
}

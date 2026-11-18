import { MembershipRole } from '@enterprise-ai/database';
import { describe, expect, it } from 'vitest';
import { assertRequiredRole, hasRequiredRole } from '../src/middleware/rbac.js';
import { ForbiddenError } from '../src/shared/errors/app-error.js';
import { hashPassword, verifyPassword } from '../src/shared/security/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from '../src/shared/security/tokens.js';

const TEST_JWT_SECRET = 'unit-test-secret-key-with-at-least-32-bytes';

describe('password hashing', () => {
  it('hashes and verifies passwords with unique salts', async () => {
    const hashA = await hashPassword('SuperSecure123!');
    const hashB = await hashPassword('SuperSecure123!');

    expect(hashA).not.toBe(hashB);
    expect(hashA.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('SuperSecure123!', hashA)).toBe(true);
    expect(await verifyPassword('WrongPassword!', hashA)).toBe(false);
    expect(await verifyPassword('SuperSecure123!', 'invalid-hash')).toBe(false);
  });
});

describe('token utilities', () => {
  it('signs and verifies access JWTs and rejects wrong secrets', async () => {
    const token = await signAccessToken(
      { sub: '11111111-1111-4111-8111-111111111111', email: 'alice@acme.test' },
      { secret: TEST_JWT_SECRET, expiresIn: '15m' },
    );

    const claims = await verifyAccessToken(token, TEST_JWT_SECRET);
    expect(claims.sub).toBe('11111111-1111-4111-8111-111111111111');
    expect(claims.email).toBe('alice@acme.test');

    await expect(
      verifyAccessToken(token, 'wrong-secret-key-with-at-least-32-bytes'),
    ).rejects.toThrow();
  });

  it('generates high-entropy refresh tokens with deterministic SHA-256 hashes', () => {
    const token1 = generateRefreshToken();
    const token2 = generateRefreshToken();

    expect(token1).not.toBe(token2);
    expect(hashRefreshToken(token1)).toBe(hashRefreshToken(token1));
    expect(hashRefreshToken(token1)).not.toBe(token1);
  });
});

describe('RBAC role hierarchy', () => {
  it('enforces OWNER > ADMIN > MEMBER ordering', () => {
    expect(hasRequiredRole(MembershipRole.OWNER, MembershipRole.MEMBER)).toBe(true);
    expect(hasRequiredRole(MembershipRole.OWNER, MembershipRole.ADMIN)).toBe(true);
    expect(hasRequiredRole(MembershipRole.OWNER, MembershipRole.OWNER)).toBe(true);

    expect(hasRequiredRole(MembershipRole.ADMIN, MembershipRole.MEMBER)).toBe(true);
    expect(hasRequiredRole(MembershipRole.ADMIN, MembershipRole.ADMIN)).toBe(true);
    expect(hasRequiredRole(MembershipRole.ADMIN, MembershipRole.OWNER)).toBe(false);

    expect(hasRequiredRole(MembershipRole.MEMBER, MembershipRole.MEMBER)).toBe(true);
    expect(hasRequiredRole(MembershipRole.MEMBER, MembershipRole.ADMIN)).toBe(false);

    expect(() =>
      assertRequiredRole(MembershipRole.MEMBER, MembershipRole.ADMIN),
    ).toThrow(ForbiddenError);
  });
});

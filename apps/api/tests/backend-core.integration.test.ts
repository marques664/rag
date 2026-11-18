import path from 'node:path';
import {
  checkDatabaseHealth,
  createDatabaseClient,
  type DatabaseClient,
} from '@enterprise-ai/database';
import { config as loadDotenv } from 'dotenv';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

loadDotenv({ path: path.resolve(import.meta.dirname, '../../../.env') });

const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://postgres:postgres@localhost:5432/enterprise_knowledge_ai_test?schema=public';

const TEST_JWT_SECRET =
  'integration-test-jwt-secret-key-minimum-32-characters';

describe('Sprint 2 Backend Core integration (Auth, Organizations, RBAC, Tenant Isolation)', () => {
  let db: DatabaseClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createDatabaseClient(TEST_DATABASE_URL);
    await db.$connect();

    app = buildApp({
      nodeEnv: 'test',
      database: db,
      authConfig: {
        jwtSecret: TEST_JWT_SECRET,
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresDays: 7,
      },
      checkDatabase: () => checkDatabaseHealth(db),
      checkRedis: async () => ({ status: 'up', latencyMs: 1 }),
    });
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "organization_invitations", "refresh_tokens", "memberships", "organizations", "users" RESTART IDENTITY CASCADE;',
    );
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  async function registerUser(params: {
    name: string;
    email: string;
    password?: string;
  }): Promise<{
    userId: string;
    accessToken: string;
    refreshToken: string;
  }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: params.name,
        email: params.email,
        password: params.password ?? 'StrongPass123!',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    return {
      userId: body.user.id as string,
      accessToken: body.tokens.accessToken as string,
      refreshToken: body.tokens.refreshToken as string,
    };
  }

  it('registers, logs in, rotates refresh tokens, detects token reuse, and logs out', async () => {
    const registered = await registerUser({
      name: 'Alice Engineer',
      email: 'Alice@Example.com',
    });

    // Duplicate email rejected even with different casing.
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Alice Clone',
        email: 'alice@example.com',
        password: 'StrongPass123!',
      },
    });
    expect(dupRes.statusCode).toBe(409);

    // Wrong password rejected.
    const badLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'alice@example.com',
        password: 'WrongPassword!',
      },
    });
    expect(badLogin.statusCode).toBe(401);

    // Valid login succeeds.
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'alice@example.com',
        password: 'StrongPass123!',
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginTokens = loginRes.json().tokens as {
      accessToken: string;
      refreshToken: string;
    };

    // Authenticated /auth/me succeeds and unauthenticated fails.
    const unauthMe = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    expect(unauthMe.statusCode).toBe(401);

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${loginTokens.accessToken}` },
    });
    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.email).toBe('alice@example.com');
    expect(meRes.json().organizations).toEqual([]);

    // Refresh rotation mints a new pair.
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: loginTokens.refreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);
    const rotatedTokens = refreshRes.json().tokens as {
      accessToken: string;
      refreshToken: string;
    };
    expect(rotatedTokens.refreshToken).not.toBe(loginTokens.refreshToken);

    // Reusing the already-rotated refresh token revokes the entire token family.
    const reuseRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: loginTokens.refreshToken },
    });
    expect(reuseRes.statusCode).toBe(401);

    const revokedChildRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: rotatedTokens.refreshToken },
    });
    expect(revokedChildRes.statusCode).toBe(401);

    // Logout revokes the registration refresh token.
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${registered.accessToken}` },
      payload: { refreshToken: registered.refreshToken },
    });
    expect(logoutRes.statusCode).toBe(200);

    const afterLogoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: registered.refreshToken },
    });
    expect(afterLogoutRes.statusCode).toBe(401);
  });

  it('supports multiple organizations per user, invitations, and RBAC rules', async () => {
    const alice = await registerUser({
      name: 'Alice Owner',
      email: 'alice@acme.test',
    });
    const bob = await registerUser({
      name: 'Bob Member',
      email: 'bob@globex.test',
    });

    // Alice creates Acme Corp (OWNER).
    const acmeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { name: 'Acme Corp', slug: 'acme-corp' },
    });
    expect(acmeRes.statusCode).toBe(201);
    const acmeId = acmeRes.json().organization.id as string;
    expect(acmeRes.json().organization.role).toBe('OWNER');

    // Duplicate explicit slug is rejected.
    const dupSlugRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { name: 'Acme Fake', slug: 'acme-corp' },
    });
    expect(dupSlugRes.statusCode).toBe(409);

    // Bob creates Globex (OWNER).
    const globexRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { name: 'Globex Inc', slug: 'globex-inc' },
    });
    expect(globexRes.statusCode).toBe(201);
    const globexId = globexRes.json().organization.id as string;

    // Alice invites Bob to Acme as MEMBER.
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${acmeId}/invitations`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { email: 'bob@globex.test', role: 'MEMBER' },
    });
    expect(inviteRes.statusCode).toBe(201);
    const invitationId = inviteRes.json().invitation.id as string;

    // Bob lists and accepts the invitation.
    const listInvRes = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations/invitations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(listInvRes.statusCode).toBe(200);
    expect(listInvRes.json().invitations).toHaveLength(1);

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${invitationId}/accept`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(acceptRes.json().organization.id).toBe(acmeId);
    expect(acceptRes.json().organization.role).toBe('MEMBER');

    // Bob now belongs to both Globex (OWNER) and Acme (MEMBER).
    const bobOrgsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(bobOrgsRes.statusCode).toBe(200);
    expect(bobOrgsRes.json().organizations).toHaveLength(2);

    // RBAC: Bob as MEMBER in Acme can view members, but cannot update Acme or invite others.
    const bobReadMembers = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${acmeId}/members`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
    });
    expect(bobReadMembers.statusCode).toBe(200);
    expect(bobReadMembers.json().members).toHaveLength(2);

    const bobPatchAcme = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${acmeId}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { name: 'Hacked Acme' },
    });
    expect(bobPatchAcme.statusCode).toBe(403);

    const bobInviteInAcme = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${acmeId}/invitations`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { email: 'charlie@test.io', role: 'MEMBER' },
    });
    expect(bobInviteInAcme.statusCode).toBe(403);

    // Alice (OWNER) promotes Bob to ADMIN in Acme.
    const promoteRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${acmeId}/members/${bob.userId}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { role: 'ADMIN' },
    });
    expect(promoteRes.statusCode).toBe(200);
    expect(promoteRes.json().member.role).toBe('ADMIN');

    // Bob (now ADMIN) can update Acme name, but still cannot invite ADMINs or demote Alice.
    const bobRenameAcme = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${acmeId}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { name: 'Acme Corporation' },
    });
    expect(bobRenameAcme.statusCode).toBe(200);
    expect(bobRenameAcme.json().organization.name).toBe('Acme Corporation');

    const bobInviteAdmin = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${acmeId}/invitations`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { email: 'charlie@test.io', role: 'ADMIN' },
    });
    expect(bobInviteAdmin.statusCode).toBe(403);

    const bobDemoteAlice = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${acmeId}/members/${alice.userId}`,
      headers: { authorization: `Bearer ${bob.accessToken}` },
      payload: { role: 'MEMBER' },
    });
    expect(bobDemoteAlice.statusCode).toBe(403);

    // Alice cannot demote herself when she is the only OWNER.
    const demoteLastOwner = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${acmeId}/members/${alice.userId}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
      payload: { role: 'ADMIN' },
    });
    expect(demoteLastOwner.statusCode).toBe(400);

    // Globex remains completely isolated from Alice.
    const aliceAccessGlobex = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${globexId}`,
      headers: { authorization: `Bearer ${alice.accessToken}` },
    });
    expect(aliceAccessGlobex.statusCode).toBe(403);
  });

  it('prevents all cross-tenant organization, member, and invitation access', async () => {
    const tenantAOwner = await registerUser({
      name: 'Tenant A Owner',
      email: 'owner@tenanta.test',
    });
    const tenantBOwner = await registerUser({
      name: 'Tenant B Owner',
      email: 'owner@tenantb.test',
    });
    const outsider = await registerUser({
      name: 'Outsider User',
      email: 'outsider@evil.test',
    });

    const orgARes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
      payload: { name: 'Tenant A', slug: 'tenant-a' },
    });
    const orgAId = orgARes.json().organization.id as string;

    const orgBRes = await app.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${tenantBOwner.accessToken}` },
      payload: { name: 'Tenant B', slug: 'tenant-b' },
    });
    const orgBId = orgBRes.json().organization.id as string;

    // Tenant A owner cannot list Tenant B in their org list.
    const listARes = await app.inject({
      method: 'GET',
      url: '/api/v1/organizations',
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
    });
    expect(listARes.statusCode).toBe(200);
    const orgIdsForA = (
      listARes.json().organizations as Array<{ id: string }>
    ).map((o) => o.id);
    expect(orgIdsForA).toEqual([orgAId]);
    expect(orgIdsForA).not.toContain(orgBId);

    // Tenant A owner is blocked from every Tenant B endpoint.
    const readB = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${orgBId}`,
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
    });
    expect(readB.statusCode).toBe(403);

    const updateB = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${orgBId}`,
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
      payload: { name: 'Cross-Tenant Hijack' },
    });
    expect(updateB.statusCode).toBe(403);

    const membersB = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${orgBId}/members`,
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
    });
    expect(membersB.statusCode).toBe(403);

    const inviteB = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${orgBId}/invitations`,
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
      payload: { email: 'attacker@tenanta.test', role: 'MEMBER' },
    });
    expect(inviteB.statusCode).toBe(403);

    const roleB = await app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${orgBId}/members/${tenantBOwner.userId}`,
      headers: { authorization: `Bearer ${tenantAOwner.accessToken}` },
      payload: { role: 'MEMBER' },
    });
    expect(roleB.statusCode).toBe(403);

    // Outsider cannot accept an invitation meant for Tenant A owner or another user.
    const inviteForBob = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${orgBId}/invitations`,
      headers: { authorization: `Bearer ${tenantBOwner.accessToken}` },
      payload: { email: 'owner@tenanta.test', role: 'MEMBER' },
    });
    expect(inviteForBob.statusCode).toBe(201);
    const inviteId = inviteForBob.json().invitation.id as string;

    const hijackAccept = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${inviteId}/accept`,
      headers: { authorization: `Bearer ${outsider.accessToken}` },
    });
    expect(hijackAccept.statusCode).toBe(403);
  });
});

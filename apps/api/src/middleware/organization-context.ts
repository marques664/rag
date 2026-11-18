import type { MembershipRole } from '@enterprise-ai/database';
import type { preHandlerHookHandler } from 'fastify';
import { OrganizationAccessDeniedError } from '../modules/organizations/organizations.errors.js';
import type { OrganizationsRepository } from '../modules/organizations/organizations.repository.js';
import {
  BadRequestError,
  UnauthorizedError,
} from '../shared/errors/app-error.js';
import { assertRequiredRole } from './rbac.js';

/**
 * Verifies that the authenticated user is a member of the organization specified
 * in `x-organization-id` and satisfies `minimumRole`.
 */
export function createRequireOrganizationRoleHook(
  organizationsRepository: Pick<OrganizationsRepository, 'findMembership'>,
  minimumRole: MembershipRole,
): preHandlerHookHandler {
  return async (request) => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    const rawHeader = request.headers['x-organization-id'];
    const organizationId =
      typeof rawHeader === 'string' ? rawHeader.trim() : undefined;

    if (!organizationId) {
      throw new BadRequestError(
        'Missing x-organization-id header',
        'MISSING_ORGANIZATION_HEADER',
      );
    }

    const membership = await organizationsRepository.findMembership(
      organizationId,
      request.auth.userId,
    );

    if (!membership) {
      throw new OrganizationAccessDeniedError();
    }

    assertRequiredRole(membership.role, minimumRole);

    request.organizationContext = {
      organizationId,
      role: membership.role,
    };
  };
}

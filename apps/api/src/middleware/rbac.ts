import { MembershipRole } from '@enterprise-ai/database';
import { ForbiddenError } from '../shared/errors/app-error.js';

const ROLE_RANK: Record<MembershipRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * Returns true if `actualRole` meets or exceeds `requiredRole`.
 */
export function hasRequiredRole(
  actualRole: MembershipRole,
  requiredRole: MembershipRole,
): boolean {
  return ROLE_RANK[actualRole] >= ROLE_RANK[requiredRole];
}

/**
 * Throws ForbiddenError if `actualRole` is lower than `requiredRole`.
 */
export function assertRequiredRole(
  actualRole: MembershipRole,
  requiredRole: MembershipRole,
  message = 'Insufficient organization permissions',
): void {
  if (!hasRequiredRole(actualRole, requiredRole)) {
    throw new ForbiddenError(message);
  }
}

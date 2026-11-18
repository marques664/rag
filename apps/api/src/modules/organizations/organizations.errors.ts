import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/app-error.js';

export class OrganizationAccessDeniedError extends ForbiddenError {
  constructor() {
    super(
      'You do not have access to this organization',
      'ORGANIZATION_ACCESS_DENIED',
    );
  }
}

export class OrganizationSlugConflictError extends ConflictError {
  constructor() {
    super('An organization with this slug already exists', 'SLUG_CONFLICT');
  }
}

export class MemberNotFoundError extends NotFoundError {
  constructor() {
    super('Organization member not found', 'MEMBER_NOT_FOUND');
  }
}

export class AlreadyOrganizationMemberError extends ConflictError {
  constructor() {
    super(
      'User is already a member of this organization',
      'ALREADY_ORGANIZATION_MEMBER',
    );
  }
}

export class LastOwnerDemotionError extends BadRequestError {
  constructor() {
    super(
      'Cannot demote the last owner of an organization',
      'LAST_OWNER_REQUIRED',
    );
  }
}

export class InvitationNotFoundError extends NotFoundError {
  constructor() {
    super('Invitation not found', 'INVITATION_NOT_FOUND');
  }
}

export class InvitationNotPendingError extends ConflictError {
  constructor() {
    super('Invitation is no longer pending', 'INVITATION_NOT_PENDING');
  }
}

export class InvitationExpiredError extends BadRequestError {
  constructor() {
    super('Invitation has expired', 'INVITATION_EXPIRED');
  }
}

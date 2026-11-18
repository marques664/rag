import { ConflictError, UnauthorizedError } from '../../shared/errors/app-error.js';

export class EmailAlreadyRegisteredError extends ConflictError {
  constructor() {
    super('An account with this email already exists', 'EMAIL_ALREADY_EXISTS');
  }
}

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super('Invalid email or password', 'INVALID_CREDENTIALS');
  }
}

export class InvalidRefreshTokenError extends UnauthorizedError {
  constructor(message = 'Invalid or expired refresh token') {
    super(message, 'INVALID_REFRESH_TOKEN');
  }
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(400, code, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code = 'UNAUTHORIZED') {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action',
    code = 'FORBIDDEN',
  ) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(404, code, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', code = 'CONFLICT') {
    super(409, code, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
    message = 'Payload exceeds maximum allowed size',
    code = 'PAYLOAD_TOO_LARGE',
  ) {
    super(413, code, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(
    message = 'Unsupported media type',
    code = 'UNSUPPORTED_MEDIA_TYPE',
  ) {
    super(415, code, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message = 'Dependent service is temporarily unavailable',
    code = 'SERVICE_UNAVAILABLE',
  ) {
    super(503, code, message);
  }
}

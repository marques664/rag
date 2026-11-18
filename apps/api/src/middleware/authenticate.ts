import type { preHandlerHookHandler } from 'fastify';
import { UnauthorizedError } from '../shared/errors/app-error.js';
import { verifyAccessToken } from '../shared/security/tokens.js';

/**
 * Extracts and verifies a Bearer JWT from the Authorization header.
 */
export function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (
    !scheme ||
    !token ||
    rest.length > 0 ||
    scheme.toLowerCase() !== 'bearer'
  ) {
    return null;
  }

  return token;
}

/**
 * Fastify preHandler hook that requires a valid access JWT and sets `request.auth`.
 */
export function createAuthenticateHook(jwtSecret: string): preHandlerHookHandler {
  return async (request) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedError('Missing or malformed Authorization header');
    }

    try {
      const claims = await verifyAccessToken(token, jwtSecret);
      request.auth = {
        userId: claims.sub,
        email: claims.email,
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  };
}

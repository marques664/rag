import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'enterprise-knowledge-ai';
const JWT_AUDIENCE = 'enterprise-knowledge-ai-api';

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface SignAccessTokenOptions {
  secret: string;
  expiresIn: string;
}

function encodeSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Signs a short-lived HMAC-SHA256 access JWT for an authenticated user.
 */
export async function signAccessToken(
  payload: AccessTokenPayload,
  options: SignAccessTokenOptions,
): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(options.expiresIn)
    .sign(encodeSecret(options.secret));
}

/**
 * Verifies an access JWT and returns the authenticated user claims.
 */
export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenPayload> {
  const { payload } = await jwtVerify(token, encodeSecret(secret), {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });

  if (typeof payload.sub !== 'string' || typeof payload['email'] !== 'string') {
    throw new Error('Token payload missing required claims');
  }

  return {
    sub: payload.sub,
    email: payload['email'],
  };
}

/**
 * Generates a cryptographically secure opaque refresh token.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Computes a deterministic SHA-256 hash of a refresh token for database storage.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

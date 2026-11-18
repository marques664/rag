import type { FastifyReply, FastifyRequest } from 'fastify';
import { extractBearerToken } from '../../middleware/authenticate.js';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { verifyAccessToken } from '../../shared/security/tokens.js';
import type { AuthService } from './auth.service.js';
import type { LoginInput, RegisterInput } from './auth.types.js';

export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtSecret: string,
  ) {}

  register = async (
    request: FastifyRequest<{ Body: RegisterInput }>,
    reply: FastifyReply,
  ) => {
    const result = await this.authService.register(request.body);
    return reply.code(201).send(result);
  };

  login = async (
    request: FastifyRequest<{ Body: LoginInput }>,
    reply: FastifyReply,
  ) => {
    const result = await this.authService.login(request.body);
    return reply.code(200).send(result);
  };

  refresh = async (
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) => {
    const result = await this.authService.refresh(request.body.refreshToken);
    return reply.code(200).send(result);
  };

  logout = async (
    request: FastifyRequest<{ Body: { refreshToken: string } }>,
    reply: FastifyReply,
  ) => {
    let userId: string | undefined;
    const bearer = extractBearerToken(request.headers.authorization);
    if (bearer) {
      try {
        const claims = await verifyAccessToken(bearer, this.jwtSecret);
        userId = claims.sub;
      } catch {
        // Allow logout with an expired access token as long as refreshToken is supplied.
      }
    }

    await this.authService.logout(request.body.refreshToken, userId);
    return reply.code(200).send({ success: true as const });
  };

  me = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      throw new UnauthorizedError();
    }

    const result = await this.authService.getCurrentUser(request.auth.userId);
    return reply.code(200).send(result);
  };
}

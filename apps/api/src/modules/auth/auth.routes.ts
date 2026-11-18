import type { ZodTypeProvider } from '@fastify/type-provider-zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { AuthController } from './auth.controller.js';
import {
  authResponseSchema,
  currentUserResponseSchema,
  loginBodySchema,
  logoutBodySchema,
  logoutResponseSchema,
  refreshBodySchema,
  refreshResponseSchema,
  registerBodySchema,
} from './auth.schema.js';

export interface AuthRouteDependencies {
  controller: AuthController;
  authenticate: preHandlerHookHandler;
}

/**
 * Registers authentication routes under /auth (mounted at /api/v1).
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDependencies,
): Promise<void> {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post('/auth/register', {
    schema: {
      body: registerBodySchema,
      response: {
        201: authResponseSchema,
      },
    },
    handler: deps.controller.register,
  });

  typedApp.post('/auth/login', {
    schema: {
      body: loginBodySchema,
      response: {
        200: authResponseSchema,
      },
    },
    handler: deps.controller.login,
  });

  typedApp.post('/auth/refresh', {
    schema: {
      body: refreshBodySchema,
      response: {
        200: refreshResponseSchema,
      },
    },
    handler: deps.controller.refresh,
  });

  typedApp.post('/auth/logout', {
    schema: {
      body: logoutBodySchema,
      response: {
        200: logoutResponseSchema,
      },
    },
    handler: deps.controller.logout,
  });

  typedApp.get('/auth/me', {
    preHandler: [deps.authenticate],
    schema: {
      response: {
        200: currentUserResponseSchema,
      },
    },
    handler: deps.controller.me,
  });
}

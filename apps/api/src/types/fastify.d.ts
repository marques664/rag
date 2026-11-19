import type { MembershipRole } from '@enterprise-ai/database';
import type { ActiveSpan, TraceContext } from '@enterprise-ai/shared';

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

export interface OrganizationRequestContext {
  organizationId: string;
  role: MembershipRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthenticatedUser | null;
    organizationContext: OrganizationRequestContext | null;
    traceContext: TraceContext | null;
    requestSpan: ActiveSpan | null;
  }
}

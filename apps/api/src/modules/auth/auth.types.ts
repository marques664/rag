import type { MembershipRole } from '@enterprise-ai/database';

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export interface AuthResponse {
  user: PublicUser;
  tokens: AuthTokens;
}

export interface RefreshResponse {
  tokens: AuthTokens;
}

export interface UserOrganizationSummary {
  organizationId: string;
  name: string;
  slug: string;
  role: MembershipRole;
}

export interface CurrentUserResponse {
  user: PublicUser;
  organizations: UserOrganizationSummary[];
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

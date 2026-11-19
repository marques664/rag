'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  apiClient,
  clearStoredSession,
  readStoredSession,
  writeStoredOrganizationId,
  writeStoredTokens,
} from '@/lib/api/client';
import type {
  PublicUser,
  UserOrganizationMembership,
} from '@/lib/api/types';

interface AuthContextValue {
  user: PublicUser | null;
  organizations: UserOrganizationMembership[];
  activeOrganizationId: string | null;
  activeOrganization: UserOrganizationMembership | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    name: string;
    email: string;
    password: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  selectOrganization: (organizationId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function resolveActiveOrganizationId(
  orgs: UserOrganizationMembership[],
  preferredId: string | null,
): string | null {
  if (orgs.length === 0) {
    return null;
  }
  if (preferredId && orgs.some((org) => org.organizationId === preferredId)) {
    return preferredId;
  }
  return orgs[0]?.organizationId ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [organizations, setOrganizations] = useState<
    UserOrganizationMembership[]
  >([]);
  const [activeOrganizationId, setActiveOrganizationId] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const stored = readStoredSession();
      if (!stored.accessToken && !stored.refreshToken) {
        await Promise.resolve();
        if (!cancelled) {
          setUser(null);
          setOrganizations([]);
          setActiveOrganizationId(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const me = await apiClient.auth.me();
        if (cancelled) return;
        const nextOrgId = resolveActiveOrganizationId(
          me.organizations,
          stored.organizationId,
        );
        writeStoredOrganizationId(nextOrgId);
        setUser(me.user);
        setOrganizations(me.organizations);
        setActiveOrganizationId(nextOrgId);
      } catch {
        if (cancelled) return;
        clearStoredSession();
        setUser(null);
        setOrganizations([]);
        setActiveOrganizationId(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const response = await apiClient.auth.login(input);
      writeStoredTokens(response.tokens);
      const me = await apiClient.auth.me();
      const stored = readStoredSession();
      const nextOrgId = resolveActiveOrganizationId(
        me.organizations,
        stored.organizationId,
      );
      writeStoredOrganizationId(nextOrgId);
      setUser(me.user);
      setOrganizations(me.organizations);
      setActiveOrganizationId(nextOrgId);
    },
    [],
  );

  const register = useCallback(
    async (input: { name: string; email: string; password: string }) => {
      const response = await apiClient.auth.register(input);
      writeStoredTokens(response.tokens);
      const me = await apiClient.auth.me();
      const nextOrgId = resolveActiveOrganizationId(me.organizations, null);
      writeStoredOrganizationId(nextOrgId);
      setUser(me.user);
      setOrganizations(me.organizations);
      setActiveOrganizationId(nextOrgId);
    },
    [],
  );

  const logout = useCallback(async () => {
    const stored = readStoredSession();
    if (stored.refreshToken) {
      try {
        await apiClient.auth.logout(stored.refreshToken);
      } catch {
        // Always clear local session even if token was already revoked.
      }
    }
    clearStoredSession();
    setUser(null);
    setOrganizations([]);
    setActiveOrganizationId(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    const stored = readStoredSession();
    const me = await apiClient.auth.me();
    const nextOrgId = resolveActiveOrganizationId(
      me.organizations,
      stored.organizationId,
    );
    writeStoredOrganizationId(nextOrgId);
    setUser(me.user);
    setOrganizations(me.organizations);
    setActiveOrganizationId(nextOrgId);
  }, []);

  const selectOrganization = useCallback(
    (organizationId: string) => {
      const exists = organizations.some(
        (org) => org.organizationId === organizationId,
      );
      if (!exists) return;
      writeStoredOrganizationId(organizationId);
      setActiveOrganizationId(organizationId);
    },
    [organizations],
  );

  const activeOrganization = useMemo(() => {
    if (!activeOrganizationId) return null;
    return (
      organizations.find(
        (org) => org.organizationId === activeOrganizationId,
      ) ?? null
    );
  }, [activeOrganizationId, organizations]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      organizations,
      activeOrganizationId,
      activeOrganization,
      isLoading,
      isAuthenticated: user !== null,
      login,
      register,
      logout,
      refreshProfile,
      selectOrganization,
    }),
    [
      user,
      organizations,
      activeOrganizationId,
      activeOrganization,
      isLoading,
      login,
      register,
      logout,
      refreshProfile,
      selectOrganization,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}

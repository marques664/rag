import type {
  AnalyticsOverview,
  ApiDiscoveryResponse,
  ApiErrorPayload,
  AuthResponse,
  AuthTokens,
  ChatMessage,
  ConversationSummary,
  CurrentUserResponse,
  DocumentDetail,
  DocumentStatus,
  DocumentStatusSnapshot,
  DocumentSummary,
  FeedbackRatingValue,
  Invitation,
  ListDocumentsResponse,
  LogoutResponse,
  MessageFeedbackDto,
  OrganizationMember,
  OrganizationRole,
  OrganizationSummary,
  Pagination,
  PerformanceAnalytics,
  ProcessingJobSummary,
  QualityAnalytics,
  RefreshResponse,
  RetrievalStrategy,
  SendMessageResponse,
  UsageAnalytics,
} from './types';

export const DEFAULT_API_BASE_URL = 'http://localhost:3001/api/v1';

export const AUTH_STORAGE_KEYS = {
  accessToken: 'ekai.accessToken',
  refreshToken: 'ekai.refreshToken',
  organizationId: 'ekai.organizationId',
} as const;

export class ApiClientError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface StoredSession {
  accessToken: string | null;
  refreshToken: string | null;
  organizationId: string | null;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage;
}

export function readStoredSession(): StoredSession {
  const storage = getStorage();
  if (!storage) {
    return { accessToken: null, refreshToken: null, organizationId: null };
  }
  return {
    accessToken: storage.getItem(AUTH_STORAGE_KEYS.accessToken),
    refreshToken: storage.getItem(AUTH_STORAGE_KEYS.refreshToken),
    organizationId: storage.getItem(AUTH_STORAGE_KEYS.organizationId),
  };
}

export function writeStoredTokens(
  tokens: Pick<AuthTokens, 'accessToken' | 'refreshToken'>,
): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(AUTH_STORAGE_KEYS.accessToken, tokens.accessToken);
  storage.setItem(AUTH_STORAGE_KEYS.refreshToken, tokens.refreshToken);
}

export function writeStoredOrganizationId(organizationId: string | null): void {
  const storage = getStorage();
  if (!storage) return;
  if (organizationId) {
    storage.setItem(AUTH_STORAGE_KEYS.organizationId, organizationId);
  } else {
    storage.removeItem(AUTH_STORAGE_KEYS.organizationId);
  }
}

export function clearStoredSession(): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(AUTH_STORAGE_KEYS.accessToken);
  storage.removeItem(AUTH_STORAGE_KEYS.refreshToken);
  storage.removeItem(AUTH_STORAGE_KEYS.organizationId);
}

export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) {
    return DEFAULT_API_BASE_URL;
  }
  return configured.replace(/\/+$/, '');
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  formData?: FormData;
  requireAuth?: boolean;
  organizationId?: string | null;
  skipRefresh?: boolean;
}

let inFlightRefresh: Promise<AuthTokens | null> | null = null;

async function parseErrorResponse(response: Response): Promise<ApiClientError> {
  try {
    const data = (await response.json()) as Partial<ApiErrorPayload>;
    return new ApiClientError(
      response.status,
      typeof data.error === 'string' ? data.error : 'API_ERROR',
      typeof data.message === 'string'
        ? data.message
        : `Request failed with status ${response.status}`,
    );
  } catch {
    return new ApiClientError(
      response.status,
      'API_ERROR',
      `Request failed with status ${response.status}`,
    );
  }
}

async function refreshAccessToken(): Promise<AuthTokens | null> {
  if (inFlightRefresh) {
    return inFlightRefresh;
  }

  const { refreshToken } = readStoredSession();
  if (!refreshToken) {
    return null;
  }

  inFlightRefresh = (async () => {
    try {
      const response = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        clearStoredSession();
        return null;
      }
      const data = (await response.json()) as RefreshResponse;
      writeStoredTokens(data.tokens);
      return data.tokens;
    } catch {
      return null;
    } finally {
      inFlightRefresh = null;
    }
  })();

  return inFlightRefresh;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    body,
    formData,
    requireAuth = true,
    organizationId,
    skipRefresh = false,
    headers: customHeaders,
    ...fetchInit
  } = options;

  const session = readStoredSession();
  const headers = new Headers(customHeaders);

  if (requireAuth && session.accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  const activeOrgId =
    organizationId === undefined ? session.organizationId : organizationId;
  if (activeOrgId && !headers.has('x-organization-id')) {
    headers.set('x-organization-id', activeOrgId);
  }

  let requestBody: BodyInit | undefined;
  if (formData) {
    requestBody = formData;
  } else if (body !== undefined) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    requestBody = JSON.stringify(body);
  }

  const normalizedPath =
    path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`${getApiBaseUrl()}${normalizedPath}`, {
    ...fetchInit,
    headers,
    body: requestBody,
  });

  if (
    response.status === 401 &&
    requireAuth &&
    !skipRefresh &&
    session.refreshToken
  ) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
  }

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const apiClient = {
  discovery: {
    get: () =>
      apiRequest<ApiDiscoveryResponse>('', {
        requireAuth: false,
        organizationId: null,
      }),
  },

  auth: {
    register: (input: { name: string; email: string; password: string }) =>
      apiRequest<AuthResponse>('/auth/register', {
        method: 'POST',
        body: input,
        requireAuth: false,
      }),
    login: (input: { email: string; password: string }) =>
      apiRequest<AuthResponse>('/auth/login', {
        method: 'POST',
        body: input,
        requireAuth: false,
      }),
    logout: (refreshToken: string) =>
      apiRequest<LogoutResponse>('/auth/logout', {
        method: 'POST',
        body: { refreshToken },
        requireAuth: false,
        skipRefresh: true,
      }),
    me: () => apiRequest<CurrentUserResponse>('/auth/me'),
  },

  organizations: {
    list: () => apiRequest<{ organizations: OrganizationSummary[] }>('/organizations'),
    create: (input: { name: string; slug?: string }) =>
      apiRequest<{ organization: OrganizationSummary }>('/organizations', {
        method: 'POST',
        body: input,
      }),
    getById: (id: string) =>
      apiRequest<{ organization: OrganizationSummary }>(`/organizations/${id}`),
    update: (id: string, input: { name?: string; slug?: string }) =>
      apiRequest<{ organization: OrganizationSummary }>(`/organizations/${id}`, {
        method: 'PATCH',
        body: input,
      }),
    listMembers: (id: string) =>
      apiRequest<{ members: OrganizationMember[] }>(`/organizations/${id}/members`),
    createInvitation: (
      id: string,
      input: { email: string; role?: 'ADMIN' | 'MEMBER' },
    ) =>
      apiRequest<{ invitation: Invitation }>(`/organizations/${id}/invitations`, {
        method: 'POST',
        body: input,
      }),
    listPendingInvitations: () =>
      apiRequest<{ invitations: Invitation[] }>('/organizations/invitations'),
    acceptInvitation: (invitationId: string) =>
      apiRequest<{ organization: OrganizationSummary }>(
        `/organizations/invitations/${invitationId}/accept`,
        { method: 'POST' },
      ),
    updateMemberRole: (
      organizationId: string,
      userId: string,
      role: OrganizationRole,
    ) =>
      apiRequest<{ member: OrganizationMember }>(
        `/organizations/${organizationId}/members/${userId}`,
        { method: 'PATCH', body: { role } },
      ),
  },

  documents: {
    upload: (file: File, organizationId?: string) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiRequest<{ document: DocumentSummary }>('/documents', {
        method: 'POST',
        formData,
        organizationId,
      });
    },
    list: (params?: { status?: DocumentStatus; page?: number; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.status) search.set('status', params.status);
      if (params?.page) search.set('page', String(params.page));
      if (params?.limit) search.set('limit', String(params.limit));
      const qs = search.toString();
      return apiRequest<ListDocumentsResponse>(
        `/documents${qs ? `?${qs}` : ''}`,
      );
    },
    getById: (id: string) =>
      apiRequest<{ document: DocumentDetail }>(`/documents/${id}`),
    getStatus: (id: string) =>
      apiRequest<{ status: DocumentStatusSnapshot }>(`/documents/${id}/status`),
    reprocess: (id: string) =>
      apiRequest<{ document: DocumentSummary; job: ProcessingJobSummary }>(
        `/documents/${id}/reprocess`,
        { method: 'POST' },
      ),
    delete: (id: string) =>
      apiRequest<{ deleted: true; documentId: string }>(`/documents/${id}`, {
        method: 'DELETE',
      }),
  },

  conversations: {
    create: (input?: { title?: string }) =>
      apiRequest<{ conversation: ConversationSummary }>('/conversations', {
        method: 'POST',
        body: input ?? {},
      }),
    list: (params?: { page?: number; limit?: number }) => {
      const search = new URLSearchParams();
      if (params?.page) search.set('page', String(params.page));
      if (params?.limit) search.set('limit', String(params.limit));
      const qs = search.toString();
      return apiRequest<{
        conversations: ConversationSummary[];
        pagination: Pagination;
      }>(`/conversations${qs ? `?${qs}` : ''}`);
    },
    getById: (id: string) =>
      apiRequest<{ conversation: ConversationSummary }>(`/conversations/${id}`),
    delete: (id: string) =>
      apiRequest<{ deleted: true; conversationId: string }>(
        `/conversations/${id}`,
        { method: 'DELETE' },
      ),
    listMessages: (
      id: string,
      params?: { page?: number; limit?: number },
    ) => {
      const search = new URLSearchParams();
      if (params?.page) search.set('page', String(params.page));
      if (params?.limit) search.set('limit', String(params.limit));
      const qs = search.toString();
      return apiRequest<{
        conversationId: string;
        messages: ChatMessage[];
        pagination: Pagination;
      }>(`/conversations/${id}/messages${qs ? `?${qs}` : ''}`);
    },
    sendMessage: (
      id: string,
      input: { content: string; topK?: number; strategy?: RetrievalStrategy },
    ) =>
      apiRequest<SendMessageResponse>(`/conversations/${id}/messages`, {
        method: 'POST',
        body: input,
      }),
  },

  feedback: {
    submit: (
      messageId: string,
      input: { rating: FeedbackRatingValue; comment?: string },
    ) =>
      apiRequest<{ feedback: MessageFeedbackDto }>(
        `/messages/${messageId}/feedback`,
        {
          method: 'POST',
          body: input,
        },
      ),
  },

  analytics: {
    overview: () =>
      apiRequest<{ overview: AnalyticsOverview }>('/dashboard/overview'),
    usage: (days = 30) =>
      apiRequest<{ usage: UsageAnalytics }>(`/analytics/usage?days=${days}`),
    performance: (days = 30) =>
      apiRequest<{ performance: PerformanceAnalytics }>(
        `/analytics/performance?days=${days}`,
      ),
    quality: (days = 30) =>
      apiRequest<{ quality: QualityAnalytics }>(
        `/analytics/quality?days=${days}`,
      ),
  },
};

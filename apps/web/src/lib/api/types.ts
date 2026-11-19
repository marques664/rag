import type {
  AnalyticsOverview,
  FeedbackRatingValue,
  MessageFeedbackDto,
  PerformanceAnalytics,
  QualityAnalytics,
  RetrievalMatchSource,
  RetrievalStrategy,
  UsageAnalytics,
} from '@enterprise-ai/shared';

export type {
  AnalyticsOverview,
  FeedbackRatingValue,
  MessageFeedbackDto,
  PerformanceAnalytics,
  QualityAnalytics,
  RetrievalMatchSource,
  RetrievalStrategy,
  UsageAnalytics,
};

export type OrganizationRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED';
export type DocumentStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ProcessingJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type MessageRole = 'USER' | 'ASSISTANT';

export interface ApiErrorPayload {
  error: string;
  message: string;
}

export interface RagCapabilities {
  defaultStrategy: RetrievalStrategy;
  embeddingsEnabled: boolean;
  llmConfigured: boolean;
  llmProvider: string | null;
  llmModel: string | null;
  embeddingProvider: string | null;
}

export interface ApiDiscoveryResponse {
  name: string;
  status: string;
  apiPrefix: string;
  endpoints: Record<string, string>;
  rag?: RagCapabilities;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

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

export interface LogoutResponse {
  success: true;
}

export interface UserOrganizationMembership {
  organizationId: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}

export interface CurrentUserResponse {
  user: PublicUser;
  organizations: UserOrganizationMembership[];
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMember {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: OrganizationRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface ProcessingJobSummary {
  id: string;
  status: ProcessingJobStatus;
  attempts: number;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentSummary {
  id: string;
  organizationId: string;
  uploadedByUserId: string | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  status: DocumentStatus;
  pageCount: number | null;
  processingVersion: number;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  chunkCount: number;
  latestJob: ProcessingJobSummary | null;
}

export interface DocumentStatusSnapshot {
  documentId: string;
  status: DocumentStatus;
  processingVersion: number;
  chunkCount: number;
  pageCount: number | null;
  errorMessage: string | null;
  processedAt: string | null;
  updatedAt: string;
  latestJob: ProcessingJobSummary | null;
}

export interface ListDocumentsResponse {
  documents: DocumentSummary[];
  pagination: Pagination;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  filename: string;
  pageNumber: number;
  chunkIndex: number;
  relevanceScore: number | null;
  excerpt: string;
  matchedBy?: RetrievalMatchSource[];
  semanticRank?: number;
  lexicalRank?: number;
  rrfScore?: number;
}

export interface MessageTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface StageLatencies {
  embeddingMs?: number;
  retrievalMs?: number;
  rerankMs?: number;
  generationMs?: number;
}

export interface UsageInformation {
  model: string;
  embeddingModel: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  embeddingInputTokens?: number;
  latencyMs: number;
  estimatedCost: number | null;
  stageLatencies?: StageLatencies;
}

export interface ConversationSummary {
  id: string;
  organizationId: string;
  userId: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  insufficientContext: boolean;
  tokenUsage: MessageTokenUsage | null;
  citations: Citation[];
  createdAt: string;
}

export interface SendMessageResponse {
  conversationId: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  citations: Citation[];
  usage: UsageInformation | null;
  insufficientContext: boolean;
}

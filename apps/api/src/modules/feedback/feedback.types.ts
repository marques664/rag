import type { FeedbackRatingValue, MessageFeedbackDto } from '@enterprise-ai/shared';

export interface SubmitFeedbackInput {
  messageId: string;
  organizationId: string;
  userId: string;
  rating: FeedbackRatingValue;
  comment?: string | null;
}

export interface SubmitFeedbackResult {
  feedback: MessageFeedbackDto & {
    createdAt: string;
    updatedAt: string;
  };
}

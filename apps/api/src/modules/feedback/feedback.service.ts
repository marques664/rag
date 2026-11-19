import { FeedbackRating, MessageRole } from '@enterprise-ai/database';
import {
  FeedbackMessageNotFoundError,
  InvalidFeedbackTargetError,
} from './feedback.errors.js';
import type { FeedbackRepository } from './feedback.repository.js';
import type {
  SubmitFeedbackInput,
  SubmitFeedbackResult,
} from './feedback.types.js';

export class FeedbackService {
  constructor(private readonly repository: FeedbackRepository) {}

  async submitFeedback(
    input: SubmitFeedbackInput,
  ): Promise<SubmitFeedbackResult> {
    const target = await this.repository.findOwnedMessage({
      messageId: input.messageId,
      organizationId: input.organizationId,
      userId: input.userId,
    });

    if (!target) {
      throw new FeedbackMessageNotFoundError();
    }

    if (target.role !== MessageRole.ASSISTANT) {
      throw new InvalidFeedbackTargetError();
    }

    const rating =
      input.rating === 'UP' ? FeedbackRating.UP : FeedbackRating.DOWN;

    const record = await this.repository.upsertFeedback({
      messageId: input.messageId,
      userId: input.userId,
      rating,
      comment: input.comment ?? null,
    });

    return {
      feedback: {
        id: record.id,
        messageId: record.messageId,
        userId: record.userId,
        rating: record.rating,
        comment: record.comment,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      },
    };
  }
}

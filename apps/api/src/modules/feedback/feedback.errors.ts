import { BadRequestError, NotFoundError } from '../../shared/errors/app-error.js';

export class FeedbackMessageNotFoundError extends NotFoundError {
  constructor() {
    super('Message not found', 'MESSAGE_NOT_FOUND');
  }
}

export class InvalidFeedbackTargetError extends BadRequestError {
  constructor() {
    super(
      'Feedback can only be submitted for assistant messages',
      'INVALID_FEEDBACK_TARGET',
    );
  }
}

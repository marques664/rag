import { NotFoundError } from '../../shared/errors/app-error.js';

export class ConversationNotFoundError extends NotFoundError {
  constructor() {
    super('Conversation not found', 'CONVERSATION_NOT_FOUND');
  }
}

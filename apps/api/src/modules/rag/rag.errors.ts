import { ServiceUnavailableError } from '../../shared/errors/app-error.js';

export class AiProviderNotConfiguredAppError extends ServiceUnavailableError {
  constructor() {
    super(
      'AI embedding or generation provider is not configured',
      'AI_PROVIDER_NOT_CONFIGURED',
    );
  }
}

export class AiProviderUnavailableError extends ServiceUnavailableError {
  constructor(
    message = 'AI provider is temporarily unavailable; please retry shortly',
  ) {
    super(message, 'AI_PROVIDER_UNAVAILABLE');
  }
}

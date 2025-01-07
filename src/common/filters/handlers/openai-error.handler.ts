import { ErrorDetails } from '../interfaces/error-details.interface';
import { OpenAIException } from '../../exceptions/openai.exception';

export class OpenAIErrorHandler {
  private static errorTypes = {
    RATE_LIMIT: 'rate_limit_exceeded',
    CONTEXT_LENGTH: 'context_length_exceeded',
    INVALID_API_KEY: 'invalid_api_key',
    INSUFFICIENT_QUOTA: 'insufficient_quota',
    INVALID_REQUEST: 'invalid_request_error',
    MODEL_NOT_FOUND: 'model_not_found',
    SERVER_ERROR: 'server_error',
  } as const;

  static handle(exception: OpenAIException): ErrorDetails {
    const response = exception.getResponse() as any;
    const errorDetails = response?.details?.error || {};

    const error = this.identifyError(errorDetails, response);

    return {
      type: 'OpenAIException',
      error,
      status: exception.getStatus(),
      details: response,
      stack: exception.stack,
    };
  }

  private static identifyError(errorDetails: any, response: any): string {
    const code = errorDetails.code || response.code;
    const type = errorDetails.type || response.type;
    const message = (
      errorDetails.message ||
      response.message ||
      ''
    ).toLowerCase();

    if (code === 'insufficient_quota' || type === 'insufficient_quota') {
      return this.errorTypes.INSUFFICIENT_QUOTA;
    }

    if (this.isRateLimit(code, type, message)) {
      return this.errorTypes.RATE_LIMIT;
    }

    if (message.includes('context length')) {
      return this.errorTypes.CONTEXT_LENGTH;
    }

    if (this.isInvalidApiKey(message)) {
      return this.errorTypes.INVALID_API_KEY;
    }

    if (this.isModelNotFound(message)) {
      return this.errorTypes.MODEL_NOT_FOUND;
    }

    if (
      type === 'invalid_request_error' ||
      message.includes('invalid request')
    ) {
      return this.errorTypes.INVALID_REQUEST;
    }

    if (message.includes('server error') || response.status >= 500) {
      return this.errorTypes.SERVER_ERROR;
    }

    return 'UNKNOWN_ERROR';
  }

  private static isRateLimit(
    code: string,
    type: string,
    message: string,
  ): boolean {
    return (
      code === 'rate_limit_exceeded' ||
      type === 'rate_limit_exceeded' ||
      message.includes('rate limit')
    );
  }

  private static isInvalidApiKey(message: string): boolean {
    return (
      message.includes('invalid api key') ||
      message.includes('incorrect api key') ||
      message.includes('no api key')
    );
  }

  private static isModelNotFound(message: string): boolean {
    return (
      message.includes('model not found') ||
      message.includes('model does not exist')
    );
  }
}

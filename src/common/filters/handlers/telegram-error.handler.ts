import { ErrorDetails } from '../interfaces/error-details.interface';
import { TelegramException } from '../../exceptions/telegram.exception';

export class TelegramErrorHandler {
  private static errorTypes = {
    UNKNOWN_COMMAND: 'UNKNOWN_COMMAND',
    FORBIDDEN: 'FORBIDDEN',
    TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FLOOD_WAIT: 'FLOOD_WAIT',
    MESSAGE_TOO_LONG: 'MESSAGE_TOO_LONG',
    CHAT_NOT_FOUND: 'CHAT_NOT_FOUND',
    USER_DEACTIVATED: 'USER_DEACTIVATED',
    BLOCKED_BY_USER: 'BLOCKED_BY_USER',
    RESPONSE_TIMEOUT: 'RESPONSE_TIMEOUT',
  } as const;

  static handle(exception: TelegramException): ErrorDetails {
    const response = exception.getResponse() as any;
    const telegramResponse = response?.response || {};

    const error = this.identifyError(telegramResponse);

    return {
      type: 'TelegramException',
      error,
      status: exception.getStatus(),
      details: response,
      stack: exception.stack,
    };
  }

  private static identifyError(response: any): string {
    if (response.command !== undefined) {
      return this.errorTypes.UNKNOWN_COMMAND;
    }

    const errorCode = response.error_code;
    const description = (response.description || '').toUpperCase();

    if (this.isForbidden(errorCode, description)) {
      return this.errorTypes.FORBIDDEN;
    }

    if (this.isTooManyRequests(errorCode, description)) {
      return this.errorTypes.TOO_MANY_REQUESTS;
    }

    if (errorCode === 400 && !description) {
      return this.errorTypes.BAD_REQUEST;
    }

    if (this.isUnauthorized(errorCode, description)) {
      return this.errorTypes.UNAUTHORIZED;
    }

    return this.identifyByDescription(description);
  }

  private static isForbidden(errorCode: number, description: string): boolean {
    return errorCode === 403 || description.includes('FORBIDDEN');
  }

  private static isTooManyRequests(
    errorCode: number,
    description: string,
  ): boolean {
    return errorCode === 429 || description.includes('TOO MANY REQUESTS');
  }

  private static isUnauthorized(
    errorCode: number,
    description: string,
  ): boolean {
    return errorCode === 401 || description.includes('UNAUTHORIZED');
  }

  private static identifyByDescription(description: string): string {
    if (description.includes('FLOOD')) return this.errorTypes.FLOOD_WAIT;
    if (description.includes('MESSAGE IS TOO LONG'))
      return this.errorTypes.MESSAGE_TOO_LONG;
    if (description.includes('CHAT NOT FOUND'))
      return this.errorTypes.CHAT_NOT_FOUND;
    if (description.includes('USER IS DEACTIVATED'))
      return this.errorTypes.USER_DEACTIVATED;
    if (
      description.includes('USER BLOCKED') ||
      description.includes('BOT BLOCKED')
    ) {
      return this.errorTypes.BLOCKED_BY_USER;
    }
    if (description.includes('TIMEOUT') || description.includes('TIME OUT')) {
      return this.errorTypes.RESPONSE_TIMEOUT;
    }

    return 'UNKNOWN_ERROR';
  }
}

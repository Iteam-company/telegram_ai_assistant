import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Request, Response } from 'express';
import { TelegramService } from 'src/telegram/telegram.service';
import { OpenAIException } from 'src/openai/openai.exceptions';
import { TelegramException } from 'src/telegram/telegram.exceptions';

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  private readonly errorMessages = new Map<string, string>([
    // OpenAI specific errors
    [
      'OpenAIException:rate_limit_exceeded',
      '⏳ Rate limit exceeded. Please try again later.',
    ],
    [
      'OpenAIException:context_length_exceeded',
      '📝 Message is too long. Please send a shorter message.',
    ],
    [
      'OpenAIException:invalid_api_key',
      '🔑 Authentication error. Please contact the administrator.',
    ],
    [
      'OpenAIException:insufficient_quota',
      '💰 Usage limit reached. Please try again tomorrow or contact the administrator.',
    ],
    [
      'OpenAIException:invalid_request_error',
      '❌ Invalid request to AI service.',
    ],
    [
      'OpenAIException:model_not_found',
      '🤖 Selected AI model is currently unavailable.',
    ],
    [
      'OpenAIException:server_error',
      '🔧 AI service is experiencing issues. Please try again later.',
    ],

    // Telegram specific errors
    [
      'TelegramException:UNKNOWN_COMMAND',
      "📃 Unknown command received. Please type '/help' to get list of commands.",
    ],
    ['TelegramException:FORBIDDEN', '🚫 Bot was blocked by the user or chat.'],
    [
      'TelegramException:TOO_MANY_REQUESTS',
      '⏳ Too many requests. Please wait a moment.',
    ],
    ['TelegramException:BAD_REQUEST', '❌ Invalid request to Telegram.'],
    ['TelegramException:UNAUTHORIZED', '🔑 Bot token is invalid.'],
    [
      'TelegramException:FLOOD_WAIT',
      '⌛ Please wait before sending more messages.',
    ],
    [
      'TelegramException:MESSAGE_TOO_LONG',
      '📝 Message is too long for Telegram.',
    ],
    ['TelegramException:CHAT_NOT_FOUND', '🔍 Chat was not found.'],
    [
      'TelegramException:USER_DEACTIVATED',
      '👤 User has deleted their account.',
    ],
    ['TelegramException:BLOCKED_BY_USER', '🚫 User has blocked the bot.'],
    ['TelegramException:RESPONSE_TIMEOUT', '⏱️ Telegram response timeout.'],

    // Default HTTP status errors
    ['default:400', '❌ Bad request. Please try again.'],
    [
      'default:401',
      '🔑 Authentication error. Please contact the administrator.',
    ],
    ['default:403', '🚫 Access forbidden.'],
    ['default:404', '🔍 Resource not found.'],
    ['default:429', '⏳ Too many requests. Please wait a minute.'],
    ['default:500', '🔧 Server error. Please try again later.'],
    ['default:502', '🌐 Bad gateway. Please try again later.'],
    ['default:503', '🏥 Service temporarily unavailable.'],
    ['default:504', '⌛ Gateway timeout. Please try again later.'],
  ]);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telegramService: TelegramService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const errorDetails = this.getErrorDetails(exception);
    const userMessage = this.getUserFriendlyMessage(errorDetails);

    const errorResponse = {
      statusCode: errorDetails.status,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
      message: userMessage,
      error: errorDetails.error,
      ...(process.env.NODE_ENV !== 'production' && {
        details: errorDetails.details,
        stack: errorDetails.stack,
      }),
    };

    this.logError(errorDetails, errorResponse);

    httpAdapter.reply(response, errorResponse, HttpStatus.OK);

    await this.handleTelegramError(request, userMessage);
  }

  private getErrorDetails(exception: any): {
    type: string;
    error: string;
    status: number;
    details?: any;
    stack?: string;
  } {
    if (exception instanceof OpenAIException) {
      return {
        type: 'OpenAIException',
        error: this.parseOpenAIError(exception),
        status: exception.getStatus(),
        details: exception.getResponse(),
        stack: exception.stack,
      };
    }

    if (exception instanceof TelegramException) {
      return {
        type: 'TelegramException',
        error: this.parseTelegramError(exception),
        status: exception.getStatus(),
        details: exception.getResponse(),
        stack: exception.stack,
      };
    }

    if (exception instanceof HttpException) {
      return {
        type: 'HttpException',
        error: 'HTTP_ERROR',
        status: exception.getStatus(),
        details: exception.getResponse(),
        stack: exception.stack,
      };
    }

    return {
      type: 'UnknownException',
      error: 'INTERNAL_SERVER_ERROR',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      details:
        exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    };
  }

  private parseOpenAIError(exception: OpenAIException): string {
    const response = exception.getResponse() as any;
    const errorDetails = response?.details?.error || {};

    // Get error information from various possible locations
    const code = errorDetails.code || response.code;
    const type = errorDetails.type || response.type;
    const message = (
      errorDetails.message ||
      response.message ||
      ''
    ).toLowerCase();

    // Check specific error codes/types first
    if (code === 'insufficient_quota' || type === 'insufficient_quota') {
      return 'insufficient_quota';
    }

    if (
      code === 'rate_limit_exceeded' ||
      type === 'rate_limit_exceeded' ||
      message.includes('rate limit')
    ) {
      return 'rate_limit_exceeded';
    }

    if (message.includes('context length')) {
      return 'context_length_exceeded';
    }

    if (
      message.includes('invalid api key') ||
      message.includes('incorrect api key') ||
      message.includes('no api key')
    ) {
      return 'invalid_api_key';
    }

    if (
      message.includes('model not found') ||
      message.includes('model does not exist')
    ) {
      return 'model_not_found';
    }

    if (
      type === 'invalid_request_error' ||
      message.includes('invalid request')
    ) {
      return 'invalid_request_error';
    }

    // Server errors
    if (message.includes('server error') || response.status >= 500) {
      return 'server_error';
    }

    return 'UNKNOWN_ERROR';
  }

  private parseTelegramError(exception: TelegramException): string {
    const response = exception.getResponse() as any;
    const telegramResponse = response?.response || {};

    // Check if it's unknown command error
    if (telegramResponse.command !== undefined) {
      return 'UNKNOWN_COMMAND';
    }

    // Get error information from various possible locations
    const errorCode = telegramResponse.error_code;
    const description = (telegramResponse.description || '').toUpperCase();

    // Match specific Telegram error codes
    if (errorCode === 403 || description.includes('FORBIDDEN')) {
      return 'FORBIDDEN';
    }

    if (errorCode === 429 || description.includes('TOO MANY REQUESTS')) {
      return 'TOO_MANY_REQUESTS';
    }

    if (errorCode === 400 && !description) {
      return 'BAD_REQUEST';
    }

    if (errorCode === 401 || description.includes('UNAUTHORIZED')) {
      return 'UNAUTHORIZED';
    }

    // Check error descriptions for specific cases
    if (description.includes('FLOOD')) {
      return 'FLOOD_WAIT';
    }

    if (description.includes('MESSAGE IS TOO LONG')) {
      return 'MESSAGE_TOO_LONG';
    }

    if (description.includes('CHAT NOT FOUND')) {
      return 'CHAT_NOT_FOUND';
    }

    if (description.includes('USER IS DEACTIVATED')) {
      return 'USER_DEACTIVATED';
    }

    if (
      description.includes('USER BLOCKED') ||
      description.includes('BOT BLOCKED')
    ) {
      return 'BLOCKED_BY_USER';
    }

    if (description.includes('TIMEOUT') || description.includes('TIME OUT')) {
      return 'RESPONSE_TIMEOUT';
    }

    return 'UNKNOWN_ERROR';
  }

  private getUserFriendlyMessage(errorDetails: {
    type: string;
    error: string;
    status: number;
  }): string {
    const specificKey = `${errorDetails.type}:${errorDetails.error}`;
    if (this.errorMessages.has(specificKey)) {
      return this.errorMessages.get(specificKey);
    }

    const defaultKey = `default:${errorDetails.status}`;
    return (
      this.errorMessages.get(defaultKey) ||
      '❌ Something went wrong. Please try again later.'
    );
  }

  private async handleTelegramError(
    request: Request,
    userMessage: string,
  ): Promise<void> {
    try {
      const chatId =
        request.body?.message?.chat?.id ||
        request.body?.callback_query?.message?.chat?.id;

      if (chatId) {
        await this.telegramService.sendMessage(userMessage);
      }
    } catch (error) {
      this.logger.error(
        'Failed to send error message to Telegram user:',
        error,
      );
    }
  }

  private logError(
    errorDetails: { type: string; error: string; status: number },
    fullError: any,
  ): void {
    const message = `[${errorDetails.type}] ${errorDetails.error}`;

    if (errorDetails.status >= 500) {
      this.logger.error(message, fullError);
    } else if (errorDetails.status >= 400) {
      this.logger.warn(message, fullError);
    } else {
      this.logger.log(message, fullError);
    }
  }
}

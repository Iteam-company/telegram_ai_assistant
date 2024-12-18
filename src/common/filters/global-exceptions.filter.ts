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
import { OpenAIException } from '../exceptions/openai.exception';
import { TelegramException } from '../exceptions/telegram.exception';
import { Error as MongooseError } from 'mongoose';
import { ErrorDetails } from './interfaces/error-details.interface';
import { OpenAIErrorHandler } from './handlers/openai-error.handler';
import { TelegramErrorHandler } from './handlers/telegram-error.handler';
import { MongooseErrorHandler } from './handlers/mongoose-error.handler';
import { ErrorMessageMap } from './error-message.map';

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telegramService: TelegramService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const errorDetails = this.identifyError(exception);
    const userMessage = ErrorMessageMap.getUserFriendlyMessage(errorDetails);

    const errorResponse = this.createErrorResponse(
      request,
      errorDetails,
      userMessage,
    );

    this.logError(errorDetails, errorResponse);

    await this.handleTelegramError(request, userMessage);

    httpAdapter.reply(response, errorResponse, HttpStatus.OK);
  }

  private identifyError(exception: unknown): ErrorDetails {
    if (exception instanceof OpenAIException) {
      return OpenAIErrorHandler.handle(exception);
    }

    if (exception instanceof TelegramException) {
      return TelegramErrorHandler.handle(exception);
    }

    if (this.isMongooseError(exception)) {
      return MongooseErrorHandler.handle(exception);
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

  private isMongooseError(error: unknown): boolean {
    return (
      error instanceof MongooseError.ValidationError ||
      error instanceof MongooseError.CastError ||
      error instanceof MongooseError.DocumentNotFoundError ||
      error instanceof MongooseError.ParallelSaveError ||
      error instanceof MongooseError.StrictModeError ||
      error instanceof MongooseError.VersionError ||
      this.isMongoError(error)
    );
  }

  private isMongoError(error: any): boolean {
    return (
      error?.name?.includes('MongoError') ||
      error?.name?.includes('MongooseError')
    );
  }

  private createErrorResponse(
    request: Request,
    errorDetails: ErrorDetails,
    userMessage: string,
  ) {
    return {
      statusCode: errorDetails.status,
      timestamp: new Date().toISOString(),
      path: this.httpAdapterHost.httpAdapter.getRequestUrl(request),
      message: userMessage,
      error: errorDetails.error,
      ...(process.env.NODE_ENV !== 'production' && {
        details: errorDetails.details,
        stack: errorDetails.stack,
      }),
    };
  }

  private async handleTelegramError(
    request: Request,
    userMessage: string,
  ): Promise<void> {
    try {
      const chatId = this.extractChatId(request);
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

  private extractChatId(request: Request): number | undefined {
    return (
      request.body?.message?.chat?.id ||
      request.body?.callback_query?.message?.chat?.id
    );
  }

  private logError(errorDetails: ErrorDetails, fullError: any): void {
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

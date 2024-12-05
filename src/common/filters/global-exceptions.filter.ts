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
import { ErrorResponse } from '../interfaces/error.interface';
import { TelegramService } from 'src/telegram/telegram.service';

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  private readonly errorMessages = new Map([
    [401, '🔑 Authentication error. Please contact the bot administrator.'],
    [403, '🌍 Sorry, this service is not available in your region.'],
    [429, '⏳ Too many requests. Please wait a minute and try again.'],
    [500, '🔧 Server error. Please try again in a few minutes.'],
    [
      503,
      '🏥 Service is temporarily overloaded. Please try again in a few minutes.',
    ],
  ]);

  private readonly quotaErrors = [
    'quota',
    'exceeded your current quota',
    'insufficient_quota',
  ];

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly telegramService: TelegramService,
  ) {}

  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const statusCode = this.getStatusCode(exception);
    const userMessage = this.getUserMessage(exception, statusCode);

    const errorResponse: ErrorResponse = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
      method: request.method,
      message: userMessage,
      body: request.body,
    };

    if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
      errorResponse.stack = exception.stack;
    }

    this.logError(errorResponse, exception);
    httpAdapter.reply(response, errorResponse, HttpStatus.OK);

    const chatId =
      request.body?.message?.chat?.id ||
      request.body?.callback_query?.message?.chat?.id;

    if (chatId) {
      await this.telegramService.sendMessage(userMessage);
    }
  }

  private getStatusCode(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    const errorResponse = (exception as any)?.response;
    return errorResponse?.status || HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getUserMessage(exception: unknown, statusCode: number): string {
    if (statusCode === 429 && this.isQuotaError(exception)) {
      return '💰 Usage limit reached. Please try again tomorrow or contact the bot administrator.';
    }

    return (
      this.errorMessages.get(statusCode) ||
      this.extractErrorMessage(exception) ||
      '❌ Something went wrong. Please try again later.'
    );
  }

  private isQuotaError(exception: unknown): boolean {
    const errorMessage = this.extractErrorMessage(exception)?.toLowerCase();
    return (
      errorMessage &&
      this.quotaErrors.some((text) => errorMessage.includes(text))
    );
  }

  private extractErrorMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return typeof response === 'string'
        ? response
        : (response as any).message || exception.message;
    }

    return exception instanceof Error ? exception.message : String(exception);
  }

  private logError(errorResponse: ErrorResponse, exception: unknown): void {
    const logMessage = {
      ...errorResponse,
      exception: exception instanceof Error ? exception.name : typeof exception,
    };

    if (errorResponse.statusCode >= 500) {
      this.logger.error(
        `Internal Server Error: ${errorResponse.message}`,
        logMessage,
      );
    } else if (errorResponse.statusCode >= 400) {
      this.logger.warn(`Client Error: ${errorResponse.message}`, logMessage);
    } else {
      this.logger.log(`Exception caught: ${errorResponse.message}`, logMessage);
    }
  }
}

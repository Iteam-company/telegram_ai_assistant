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

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const httpStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let errorMessage: string;
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      errorMessage =
        typeof response === 'string'
          ? response
          : (response as any).message || exception.message;
    } else if (exception instanceof Error) {
      errorMessage = exception.message;
    } else {
      errorMessage = String(exception);
    }

    const errorResponse: ErrorResponse = {
      statusCode: httpStatus,
      timestamp: new Date().toISOString(),
      path: httpAdapter.getRequestUrl(request),
      method: request.method,
      message: errorMessage,
      body: request.body,
    };

    if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
      errorResponse.stack = exception.stack;
    }

    this.logError(errorResponse, exception);

    httpAdapter.reply(response, errorResponse, httpStatus);
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

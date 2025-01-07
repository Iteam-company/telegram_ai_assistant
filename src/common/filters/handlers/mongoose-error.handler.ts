import { HttpStatus } from '@nestjs/common';
import { Error as MongooseError } from 'mongoose';
import { ErrorDetails } from '../interfaces/error-details.interface';

export class MongooseErrorHandler {
  private static errorTypes = {
    VALIDATION: 'ValidationError',
    CAST: 'CastError',
    NOT_FOUND: 'DocumentNotFoundError',
    DUPLICATE: 'DuplicateKeyError',
    VERSION: 'VersionError',
    PARALLEL_SAVE: 'ParallelSaveError',
    STRICT_MODE: 'StrictModeError',
    DISCONNECTED: 'DisconnectedError',
    TIMEOUT: 'TimeoutError',
  } as const;

  static handle(error: any): ErrorDetails {
    const errorType = this.identifyErrorType(error);

    return {
      type: 'MongooseError',
      error: errorType,
      status: HttpStatus.BAD_REQUEST,
      details: this.formatErrorDetails(error, errorType),
      stack: error.stack,
    };
  }

  private static identifyErrorType(error: any): string {
    if (error instanceof MongooseError.ValidationError) {
      return this.errorTypes.VALIDATION;
    }
    if (error instanceof MongooseError.CastError) {
      return this.errorTypes.CAST;
    }
    if (error instanceof MongooseError.DocumentNotFoundError) {
      return this.errorTypes.NOT_FOUND;
    }
    if (error.code === 11000) {
      return this.errorTypes.DUPLICATE;
    }
    if (error instanceof MongooseError.VersionError) {
      return this.errorTypes.VERSION;
    }
    if (error instanceof MongooseError.ParallelSaveError) {
      return this.errorTypes.PARALLEL_SAVE;
    }
    if (error instanceof MongooseError.StrictModeError) {
      return this.errorTypes.STRICT_MODE;
    }
    if (this.isDisconnectedError(error)) {
      return this.errorTypes.DISCONNECTED;
    }
    if (this.isTimeoutError(error)) {
      return this.errorTypes.TIMEOUT;
    }

    return 'UNKNOWN_MONGOOSE_ERROR';
  }

  private static isDisconnectedError(error: any): boolean {
    return (
      error.name === 'MongooseError' && error.message.includes('disconnected')
    );
  }

  private static isTimeoutError(error: any): boolean {
    return error.name === 'MongooseError' && error.message.includes('timeout');
  }

  private static formatErrorDetails(error: any, errorType: string): any {
    switch (errorType) {
      case this.errorTypes.VALIDATION:
        return this.formatValidationError(error);
      case this.errorTypes.CAST:
        return this.formatCastError(error);
      case this.errorTypes.DUPLICATE:
        return this.formatDuplicateError(error);
      default:
        return error.message;
    }
  }

  private static formatValidationError(
    error: MongooseError.ValidationError,
  ): any {
    const formattedErrors = {};
    for (const field in error.errors) {
      formattedErrors[field] = {
        message: error.errors[field].message,
        type: error.errors[field].kind,
        value: error.errors[field].value,
      };
    }
    return formattedErrors;
  }

  private static formatCastError(error: MongooseError.CastError): any {
    return {
      path: error.path,
      value: error.value,
      kind: error.kind,
    };
  }

  private static formatDuplicateError(error: any): any {
    const field = Object.keys(error.keyPattern)[0];
    return {
      field,
      value: error.keyValue[field],
    };
  }
}

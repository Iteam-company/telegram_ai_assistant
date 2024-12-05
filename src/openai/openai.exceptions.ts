import { HttpException, HttpStatus } from '@nestjs/common';

export class OpenAIException extends HttpException {
  constructor(
    message: string,
    error: any,
    status: number = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(
      {
        message,
        error: 'OpenAI API Error',
        details: error,
        code: error.error?.code || error.code,
        type: error.error?.type || error.type,
        timestamp: new Date().toISOString(),
      },
      status,
    );
  }
}

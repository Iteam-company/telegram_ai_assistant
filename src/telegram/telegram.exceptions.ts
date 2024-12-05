import { HttpException, HttpStatus } from '@nestjs/common';

export class TelegramException extends HttpException {
  constructor(
    message: string,
    response: any,
    status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(
      {
        message,
        error: 'Telegram API Error',
        response,
        timestamp: new Date().toISOString(),
      },
      status,
    );
  }
}

export class TelegramUnknownCommandException extends TelegramException {
  constructor(command: string) {
    super('Unknown command', { command }, HttpStatus.BAD_REQUEST);
  }
}

import { HttpException, HttpStatus } from '@nestjs/common';

export class TelegramException extends HttpException {
  constructor(message: string, response: any) {
    super(
      {
        message,
        error: 'Telegram API Error',
        response,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

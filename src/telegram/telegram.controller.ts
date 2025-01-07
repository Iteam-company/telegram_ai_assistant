import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './interfaces/telegram-update.interface';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly telegramService: TelegramService) {}

  @Post('webhook')
  @HttpCode(200)
  async handleWebhook(@Body() update: TelegramUpdate) {
    await this.telegramService.handleUpdate(update);
  }
}

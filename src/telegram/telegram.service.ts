import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OpenaiService } from 'src/openai/openai.service';
import { TelegramMessage } from './interfaces/telegram-message.interface';
import { TelegramUpdate } from './interfaces/telegram-update.interface';
import { TelegramException } from './telegram.exceptions';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private httpService: HttpService,
    private openaiService: OpenaiService,
  ) {}

  async sendMessage(chatId: number, text: string): Promise<boolean> {
    const response = this.httpService.post('sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
    });
    const { data } = await firstValueFrom(response);

    if (!data.ok) {
      throw new TelegramException('Failed to send message', data);
    }

    return data.ok;
  }

  async setWebhook(url: string): Promise<boolean> {
    const response = this.httpService.post('setWebhook', {
      url,
      allowed_updates: ['message', 'callback_query'],
      max_connections: 100,
    });
    const { data } = await firstValueFrom(response);

    if (!data.ok) {
      throw new TelegramException('Failed to set webhook', data);
    }

    return data.ok;
  }

  async handleUpdate(update: TelegramUpdate) {
    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage) {
    const chatId = message.chat.id;

    if (message.text?.startsWith('/start')) {
      await this.sendMessage(
        chatId,
        'Welcome! I am a bot powered by ChatGPT. Ask me anything!',
      );
    } else if (message.text?.startsWith('/reset')) {
      this.openaiService.resetHistory(chatId);
      await this.sendMessage(chatId, 'Conversation history has been reset.');
    } else if (message.text) {
      await this.sendChatAction(chatId, 'typing');

      try {
        const gptResponse = await this.openaiService.getResponse(
          chatId,
          message.text,
        );
        await this.sendMessage(chatId, gptResponse);
      } catch (error) {
        console.log(error);
        await this.sendMessage(
          chatId,
          'Sorry, I encountered an error processing your request. Please try again later.',
        );
      }
    }
  }

  private async handleCallbackQuery(callbackQuery: any) {
    const chatId = callbackQuery.message.chat.id;
    await this.sendMessage(chatId, `Callback received: ${callbackQuery.data}`);
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    await this.httpService.post('sendChatAction', {
      chat_id: chatId,
      action: action,
    });
  }
}

import { HttpException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OpenaiService } from 'src/openai/openai.service';
import { TelegramMessage } from './interfaces/telegram-message.interface';
import { TelegramUpdate } from './interfaces/telegram-update.interface';
import { TelegramException } from './telegram.exceptions';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly commands = new Map<
    string,
    (string?) => Promise<string> | string
  >();
  private chatId: number;

  constructor(
    private httpService: HttpService,
    private openaiService: OpenaiService,
  ) {
    this.registerCommands();
  }

  private registerCommands() {
    this.commands.set('', this.handleAI);
    this.commands.set('/resethistory', this.handleHistoryReset);
    this.commands.set('/start', this.handleStart);
    this.commands.set('/help', this.handleHelp);
  }

  async sendMessage(text: string): Promise<boolean> {
    const response = this.httpService.post('sendMessage', {
      chat_id: this.chatId,
      text: text,
      parse_mode: 'HTML',
    });
    const { data } = await firstValueFrom(response);

    if (!data.ok) {
      throw new TelegramException('Failed to send message', data);
    }

    return data.ok;
  }

  async sendChatAction(action: string): Promise<boolean> {
    const response = this.httpService.post('sendChatAction', {
      chat_id: this.chatId,
      action: action,
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
    this.chatId = message.chat.id;

    const text = message.text;
    if (text) {
      await this.handleTextMessages(text);
    }
  }

  private async handleCallbackQuery(callbackQuery: any) {
    this.chatId = callbackQuery.message.chat.id;
    await this.sendMessage(`Callback received: ${callbackQuery.data}`);
  }

  private async handleTextMessages(text: string): Promise<boolean> {
    const { command, content } = this.parseCommand(text);
    const handler = this.commands.get(command);

    // Handle unknown commands ("/unknowncommand", "/something")
    // Note. Empty string is a command for conversation with AI
    if (!handler) {
      return await this.sendMessage(
        "Unknown command received. Please type '/help' to get list of commands.",
      );
    }

    // Call used to bound 'this' in handler-methods
    const responseMessage = await handler.call(this, content);
    return await this.sendMessage(responseMessage);
  }

  private parseCommand(input: string): { command: string; content: string } {
    const trimmedInput = input.trim();

    // Plain text for conversation with AI
    if (!trimmedInput.startsWith('/')) {
      return { command: '', content: trimmedInput };
    }

    // Only command
    const firstSpaceIndex = trimmedInput.indexOf(' ');
    if (firstSpaceIndex === -1) {
      return { command: trimmedInput, content: '' };
    }

    return {
      command: trimmedInput.slice(0, firstSpaceIndex),
      content: trimmedInput.slice(firstSpaceIndex + 1),
    };
  }

  private handleStart() {
    return "Welcome👋! I am a bot🤖 powered by ChatGPT. Ask me anything!\nOr type '/help' to get list of commands.";
  }

  private handleHelp() {
    return 'LIST OF COMMANDS';
  }

  private async handleAI(content) {
    await this.sendChatAction('typing');
    const gptResponse = await this.openaiService.getResponse(
      this.chatId,
      content,
    );
    return gptResponse;
  }

  private async handleHistoryReset() {
    await this.openaiService.resetHistory(this.chatId);
    return 'Conversation history has been reset.';
  }
}

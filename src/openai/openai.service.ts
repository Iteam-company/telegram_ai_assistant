import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

interface ChatHistory {
  [chatId: number]: Array<OpenAI.Chat.ChatCompletionMessageParam>;
}

@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);
  private openai: OpenAI;
  private chatHistories: ChatHistory = {};
  private MAX_HISTORY: number;
  private MODEL: string;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    this.MAX_HISTORY = this.configService.get<number>('OPENAI_MAX_HISTORY');
    this.MODEL = this.configService.get<string>('OPENAI_MODEL');
  }

  async getResponse(chatId: number, message: string): Promise<string> {
    try {
      if (!this.chatHistories[chatId]) {
        this.chatHistories[chatId] = [];
      }

      this.chatHistories[chatId].push({ role: 'user', content: message });

      if (this.chatHistories[chatId].length > this.MAX_HISTORY) {
        this.chatHistories[chatId] = this.chatHistories[chatId].slice(
          -this.MAX_HISTORY,
        );
      }

      const completion = await this.openai.chat.completions.create({
        messages: this.chatHistories[chatId],
        model: this.MODEL,
      });

      const response =
        completion.choices[0].message.content ||
        'Sorry, I could not process that.';
      this.chatHistories[chatId].push({ role: 'assistant', content: response });

      return response;
    } catch (error) {
      this.logger.error('OpenAI API Error:', error);
      const status = error.response?.status || error.status || 500;
      throw new HttpException(error.message, status);
    }
  }

  resetHistory(chatId: number): void {
    this.chatHistories[chatId] = [];
  }
}

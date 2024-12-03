import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

interface ChatHistory {
  [chatId: number]: Array<OpenAI.Chat.ChatCompletionMessageParam>;
}

@Injectable()
export class OpenaiService {
  private openai: OpenAI;
  private chatHistories: ChatHistory = {};
  private readonly MAX_HISTORY = 10;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_TOKEN'),
    });
  }

  async getResponse(chatId: number, message: string): Promise<string> {
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
      model: 'gpt-3.5-turbo',
    });

    const response =
      completion.choices[0].message.content ||
      'Sorry, I could not process that.';
    this.chatHistories[chatId].push({ role: 'assistant', content: response });

    return response;
  }

  // async getResponse(chatId: number, message: string): Promise<string> {
  //   console.log(message);
  //   const completion = await this.openai.chat.completions.create({
  //     messages: [{ role: 'user', content: message }],
  //     model: 'text-embedding-3-large',
  //   });

  //   return (
  //     completion.choices[0].message.content ||
  //     'Sorry, I could not process that.'
  //   );
  // }

  resetHistory(chatId: number): void {
    this.chatHistories[chatId] = [];
  }
}

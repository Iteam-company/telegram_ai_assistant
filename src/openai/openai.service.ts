import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { OpenAIException } from '../common/exceptions/openai.exception';
import { ChatService } from 'src/chat/chat.service';
import { Message } from 'src/chat/chat.schema';

@Injectable()
export class OpenaiService {
  private readonly logger = new Logger(OpenaiService.name);
  private openai: OpenAI;
  private chatHistory: Omit<Message, 'timestamp'>[] = [];
  private MAX_HISTORY: number;
  private MODEL: string;

  constructor(
    private configService: ConfigService,
    private chatService: ChatService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });

    this.MAX_HISTORY = this.configService.get<number>('OPENAI_MAX_HISTORY');
    this.MODEL = this.configService.get<string>('OPENAI_MODEL');
  }

  async getResponse(chatId: number, message: string): Promise<string> {
    try {
      // const dialogPart = [];
      // this.chatHistory = await this.chatService.getConversationHistory(chatId);

      // this.chatHistory.push({ role: 'user', content: message });
      // dialogPart.push({ role: 'user', content: message });

      // const completion = await this.openai.chat.completions.create({
      //   messages: this.chatHistory,
      //   model: this.MODEL,
      // });

      // const response =
      //   completion.choices[0].message.content ||
      //   'Sorry, I could not process that.';

      // this.chatHistory.push({ role: 'assistant', content: response });
      // dialogPart.push({ role: 'assistant', content: response });

      // this.chatService.pushMessagesWithMaxHistory(
      //   chatId,
      //   dialogPart,
      //   this.MAX_HISTORY,
      // );

      // return response;

      return `Ok: ${message}`;
    } catch (error) {
      this.logger.error('OpenAI API Error:', error);
      const status = error.response?.status || error.status || 500;
      throw new OpenAIException(error.message, error, status);
    }
  }
}

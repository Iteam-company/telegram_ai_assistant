import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TelegramService } from '../telegram.service';
import { MessageJobData } from '../interfaces/job.inteface';
import { OpenaiService } from 'src/openai/openai.service';

@Processor('messages')
export class MessagesProcessor {
  private readonly logger = new Logger(MessagesProcessor.name);

  constructor(
    private telegramService: TelegramService,
    private openaiService: OpenaiService,
  ) {}

  @Process('delayed-message')
  async handleDirectMessage(job: Job<MessageJobData>) {
    const { chatId, message } = job.data;
    try {
      await this.telegramService.sendMessage(message, chatId);
      // this.logger.log(`Sent direct message to chat ${chatId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send direct message to chat ${chatId}: ${error.message}`,
      );
      throw error;
    }
  }

  @Process('ai-message')
  async handleDelayedMessage(job: Job<MessageJobData>) {
    const { chatId, message } = job.data;
    try {
      const openaiResponce = await this.openaiService.getResponse(message);
      await this.telegramService.sendMessage(openaiResponce, chatId);
      // this.logger.log(`Sent delayed message to chat ${chatId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send delayed message to chat ${chatId}: ${error.message}`,
      );
      throw error;
    }
  }
}

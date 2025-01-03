import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TelegramService } from '../telegram.service';
import { NotificationJobData } from '../interfaces/job.inteface';

@Processor('notifications')
export class NotificationsProcessor {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private telegramService: TelegramService) {}

  @Process('inactivity')
  async handleInactivityAlert(job: Job<NotificationJobData>) {
    const { chatId } = job.data;
    try {
      await this.telegramService.sendMessage(
        "👋 Hey! We haven't heard from you for a while. How are you doing?",
        chatId,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send inactivity alert to chat ${chatId}: ${error.message}`,
      );
      throw error;
    }
  }
}

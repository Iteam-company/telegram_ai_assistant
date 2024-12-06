import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TelegramService } from '../telegram.service';
import { ReminderJobData } from '../interfaces/job.inteface';

@Processor('reminders')
export class RemindersProcessor {
  private readonly logger = new Logger(RemindersProcessor.name);

  constructor(private telegramService: TelegramService) {}

  @Process('daily-reminder')
  async handleDailyReminder(job: Job<ReminderJobData>) {
    const { chatId, message } = job.data;
    try {
      await this.telegramService.sendMessage(message, chatId);
      this.logger.log(`Sent daily reminder to chat ${chatId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send daily reminder to chat ${chatId}: ${error.message}`,
      );
      throw error;
    }
  }

  @Process('custom-reminder')
  async handleCustomReminder(job: Job<ReminderJobData>) {
    const { chatId, message } = job.data;
    try {
      await this.telegramService.sendMessage(message, chatId);
      this.logger.log(`Sent custom reminder to chat ${chatId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send custom reminder to chat ${chatId}: ${error.message}`,
      );
      throw error;
    }
  }
}

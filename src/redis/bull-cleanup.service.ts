import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MessageJobData,
  NotificationJobData,
  ReminderJobData,
} from './interfaces/job.inteface';
import { Queue } from 'bull';

@Injectable()
export class CleanupService {
  constructor(
    @InjectQueue('messages') private messagesQueue: Queue<MessageJobData>,
    @InjectQueue('reminders') private remindersQueue: Queue<ReminderJobData>,
    @InjectQueue('notifications')
    private notificationsQueue: Queue<NotificationJobData>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cleanupOldJobs() {
    try {
      const completedRemindersJobs = await this.remindersQueue.getCompleted();
      const completedMessagesJobs = await this.messagesQueue.getCompleted();
      const completedNotificationsJobs =
        await this.notificationsQueue.getCompleted();

      await Promise.all(completedRemindersJobs.map((job) => job.remove()));
      await Promise.all(completedMessagesJobs.map((job) => job.remove()));
      await Promise.all(completedNotificationsJobs.map((job) => job.remove()));

      const failedRemindersJobs = await this.remindersQueue.getFailed();
      const failedMessagesJobs = await this.remindersQueue.getFailed();
      const failedNotificationsJobs = await this.remindersQueue.getFailed();

      await Promise.all(failedRemindersJobs.map((job) => job.remove()));
      await Promise.all(failedMessagesJobs.map((job) => job.remove()));
      await Promise.all(failedNotificationsJobs.map((job) => job.remove()));

      await this.remindersQueue.clean(0, 'completed');
      await this.remindersQueue.clean(0, 'failed');
      await this.messagesQueue.clean(0, 'completed');
      await this.messagesQueue.clean(0, 'failed');
      await this.notificationsQueue.clean(0, 'completed');
      await this.notificationsQueue.clean(0, 'failed');
    } catch (error) {
      console.error('Failed to cleanup old jobs:', error);
    }
  }
}

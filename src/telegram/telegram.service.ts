import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { firstValueFrom } from 'rxjs';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OpenaiService } from 'src/openai/openai.service';
import {
  MessageJobData,
  ReminderJobData,
  NotificationJobData,
} from './interfaces/job.inteface';
import {
  TelegramException,
  TelegramUnknownCommandException,
} from './telegram.exceptions';
import { TelegramUpdate } from './interfaces/telegram-update.interface';
import { TelegramMessage } from './interfaces/telegram-message.interface';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly commands = new Map<
    string,
    (string?) => Promise<string> | string
  >();
  private chatId: number;
  private userLastActivity: Map<number, Date> = new Map();

  constructor(
    private httpService: HttpService,
    private openaiService: OpenaiService,
    @InjectQueue('messages') private messagesQueue: Queue<MessageJobData>,
    @InjectQueue('reminders') private remindersQueue: Queue<ReminderJobData>,
    @InjectQueue('notifications')
    private notificationsQueue: Queue<NotificationJobData>,
  ) {
    this.registerCommands();
  }

  private registerCommands() {
    this.commands.set('', this.handleAI);
    this.commands.set('/resethistory', this.handleHistoryReset);
    this.commands.set('/start', this.handleStart);
    this.commands.set('/help', this.handleHelp);
    this.commands.set('/schedule', this.handleSchedule);
    this.commands.set('/reminder', this.handleReminder);
    this.commands.set('/unschedule', this.handleUnschedule);
    this.commands.set('/list_scheduled', this.handleListScheduled);
  }

  async sendMessage(text: string, specificChatId?: number): Promise<boolean> {
    const chatId = specificChatId || this.chatId;
    const response = this.httpService.post('sendMessage', {
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML',
    });
    const { data } = await firstValueFrom(response);

    if (!data.ok) {
      throw new TelegramException(
        'Failed to send message',
        data,
        HttpStatus.BAD_REQUEST,
      );
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
      throw new TelegramException(
        'Failed to send chat action',
        data,
        HttpStatus.BAD_REQUEST,
      );
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
      throw new TelegramException(
        'Failed to set webhook',
        data,
        HttpStatus.BAD_REQUEST,
      );
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
    this.userLastActivity.set(message.chat.id, new Date());

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

    if (!handler) {
      throw new TelegramUnknownCommandException(command);
    }

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

  private async handleSchedule(content: string): Promise<string> {
    if (!content || !content.includes(' ')) {
      return 'Please provide both time and message. Format: /schedule HH:MM Your message';
    }

    const [time, ...messageWords] = content.split(' ');
    const message = messageWords.join(' ');

    if (!message) {
      return 'Please provide a message to schedule';
    }

    try {
      const [hours, minutes] = time.split(':').map(Number);

      if (
        isNaN(hours) ||
        isNaN(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
      ) {
        return 'Invalid time format. Please use HH:MM format (e.g., 14:30)';
      }

      const cronPattern = `${minutes} ${hours} * * *`;
      const jobId = `${this.chatId}-${hours}-${minutes}`;

      await this.remindersQueue.add(
        'daily-reminder',
        {
          chatId: this.chatId,
          message,
          type: 'daily',
          cronPattern,
          time,
          createdAt: new Date(),
        },
        {
          repeat: { cron: cronPattern },
          jobId,
          removeOnComplete: false,
          removeOnFail: false,
        },
      );

      return `✅ Successfully scheduled message:\n"${message}"\nfor ${time} daily\nJob ID: ${jobId}`;
    } catch (error) {
      this.logger.error('Schedule error:', error);
      return 'Failed to schedule message. Please try again.';
    }
  }

  private async handleReminder(content: string): Promise<string> {
    const [delayStr, ...messageWords] = content.split(' ');
    const message = messageWords.join(' ');
    const delay = parseInt(delayStr) * 60 * 1000; // Convert minutes to milliseconds

    if (isNaN(delay) || !message) {
      return 'Please specify delay in minutes and message. Format: /reminder 30 Your message';
    }

    try {
      await this.messagesQueue.add(
        'delayed-message',
        {
          chatId: this.chatId,
          message,
          type: 'delayed',
          createdAt: new Date(),
        },
        {
          delay,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      );

      return `✅ Reminder set for ${delayStr} minutes from now`;
    } catch (error) {
      this.logger.error('Reminder error:', error);
      return 'Failed to set reminder. Please try again.';
    }
  }

  private async handleUnschedule(jobId: string): Promise<string> {
    try {
      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();
      const job = repeatableJobs.find((j) => j.id === jobId);

      if (!job) {
        return 'Scheduled message not found';
      }

      await this.remindersQueue.removeRepeatableByKey(job.key);
      return '✅ Successfully removed scheduled message';
    } catch (error) {
      this.logger.error('Unschedule error:', error);
      return 'Failed to remove scheduled message. Please try again.';
    }
  }

  private async handleListScheduled(): Promise<string> {
    try {
      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();

      const userJobs = repeatableJobs.filter((job) =>
        job.id?.startsWith(`${this.chatId}`),
      );

      if (userJobs.length === 0) {
        return 'You have no scheduled messages';
      }

      const jobsList = userJobs
        .map((job) => {
          const [minutes, hours] = job.cron.split(' ');
          return `🕒 ${hours}:${minutes} - Job ID: <code>${job.id}</code>🕒`;
        })
        .join('\n');

      return `Your scheduled messages:\n${jobsList}`;
    } catch (error) {
      this.logger.error('List scheduled error:', error);
      return 'Failed to list scheduled messages. Please try again.';
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkInactiveUsers() {
    const now = new Date();
    for (const [chatId, lastActivity] of this.userLastActivity.entries()) {
      const hoursSinceLastActivity =
        (now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastActivity >= 1) {
        await this.notificationsQueue.add('inactivity', {
          chatId,
          type: 'inactivity',
          createdAt: new Date(),
        });
      }
    }
  }
}

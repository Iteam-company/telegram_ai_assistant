import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { firstValueFrom, min } from 'rxjs';
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
  TelegramWarningException,
} from '../common/exceptions/telegram.exception';
import { TelegramUpdate } from './interfaces/telegram-update.interface';
import { TelegramMessage } from './interfaces/telegram-message.interface';
import { ChatService } from 'src/chat/chat.service';
import { CommandStateService } from 'src/redis/command-state.service';
import { CommandState } from './interfaces/command-state.interface';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly commands = new Map<
    string,
    (string?) => Promise<string> | string
  >();
  private chatId: number;
  private inactiveMinutesThreshold: number = 60 * 24;

  constructor(
    private httpService: HttpService,
    private openaiService: OpenaiService,
    private chatService: ChatService,
    @InjectQueue('messages') private messagesQueue: Queue<MessageJobData>,
    @InjectQueue('reminders') private remindersQueue: Queue<ReminderJobData>,
    @InjectQueue('notifications')
    private notificationsQueue: Queue<NotificationJobData>,
    private commandStateService: CommandStateService,
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

  async sendChatAction(
    action: string,
    specificChatId?: number,
  ): Promise<boolean> {
    const chatId = specificChatId || this.chatId;
    const response = this.httpService.post('sendChatAction', {
      chat_id: chatId,
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
    this.chatId =
      update.message.chat.id || update.callback_query.message.chat.id;

    await this.chatService.findOrCreateChat(this.chatId);
    await this.chatService.updateLastActivity(this.chatId);

    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    }
  }

  private async handleMessage(message: TelegramMessage) {
    const text = message.text;
    if (text) {
      await this.handleTextMessages(text);
    }
  }

  private async handleCallbackQuery(callbackQuery: any) {
    await this.sendMessage(`Callback received: ${callbackQuery.data}`);
  }

  private async handleTextMessages(text: string): Promise<boolean> {
    const state = await this.commandStateService.getCommandState(this.chatId);

    if (state?.awaitingResponse) {
      return await this.handleCommandResponse(state, text);
    }

    const { command, content } = this.parseCommand(text);
    const handler = this.commands.get(command);

    if (!handler) {
      throw new TelegramUnknownCommandException(command);
    }

    if (content && this.supportsDirectInput(command)) {
      const responseMessage = await handler.call(this, content);
      return await this.sendMessage(responseMessage);
    }

    if (!content && this.requiresResponse(command)) {
      await this.commandStateService.setCommandState(this.chatId, {
        command,
        awaitingResponse: true,
        expectedResponseType: this.getExpectedResponseType(command),
        timestamp: Date.now(),
      });
      return await this.sendMessage(this.getPromptForCommand(command));
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

  private requiresResponse(command: string): boolean {
    const requiresResponseCommands = ['/reminder', '/schedule', '/unschedule'];
    return requiresResponseCommands.includes(command);
  }

  private supportsDirectInput(command: string): boolean {
    const supportsDirectInputCommands = [
      '/reminder',
      '/schedule',
      '/unschedule',
    ];
    return supportsDirectInputCommands.includes(command);
  }

  private getExpectedResponseType(command: string): string {
    const responseTypes = {
      '/reminder': 'time_and_message',
      '/schedule': 'time_and_message',
      '/unschedule': 'schedule_id',
    };
    return responseTypes[command] || 'text';
  }

  private getPromptForCommand(command: string): string {
    const prompts = {
      '/reminder':
        'Please enter time in minutes and message (e.g. "30 Call Mom")',
      '/schedule':
        'Please enter time (HH:MM) and message (e.g. "14:30 Daily standup")',
      '/unschedule':
        'Please enter the copied schedule-ID from schedule list (e.g. "123456789-12-35")',
    };
    return prompts[command] || 'Please enter your response:';
  }

  private async handleCommandResponse(
    state: CommandState,
    response: string,
  ): Promise<boolean> {
    const handler = this.commands.get(state.command);
    const responseMessage = await handler.call(this, response);

    await this.commandStateService.clearCommandState(this.chatId);

    return await this.sendMessage(responseMessage);
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
    await this.chatService.clearConversationHistory(this.chatId);
    return 'Conversation history has been reset.';
  }

  private async handleSchedule(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please provide both time and message. Format: /schedule HH:MM Your message',
      );
    }

    const [time, ...messageWords] = content.split(' ');
    const message = messageWords.join(' ');

    if (!message) {
      throw new TelegramWarningException(
        'Please provide a message to schedule',
      );
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
        throw new TelegramWarningException(
          'Invalid time format. Please use HH:MM format (e.g., 14:30)',
        );
      }

      const cronPattern = `${minutes} ${hours} * * *`;

      const formatedMinutes = minutes <= 9 ? `0${minutes}` : `${minutes}`;
      const formatedHours = hours <= 9 ? `0${hours}` : `${hours}`;

      const jobId = `${this.chatId}-${formatedHours}-${formatedMinutes}`;

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
      throw new TelegramWarningException(
        'Failed to schedule message. Please try again.',
      );
    }
  }

  private async handleReminder(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please specify delay in minutes and message. Format: /reminder 30 Your message',
      );
    }

    const [delayStr, ...messageWords] = content.split(' ');
    const message = messageWords.join(' ');
    const delay = parseInt(delayStr) * 60 * 1000; // Convert minutes to milliseconds

    if (!message) {
      throw new TelegramWarningException(
        'Please provide a message for the reminder',
      );
    }
    if (isNaN(delay) || delay <= 0) {
      throw new TelegramWarningException(
        'Please specify delay in minutes. Format: /reminder 30 Your message',
      );
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
      throw new TelegramWarningException(
        'Failed to set reminder. Please try again.',
      );
    }
  }

  private async handleUnschedule(jobId: string): Promise<string> {
    try {
      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();
      const job = repeatableJobs.find((j) => j.id === jobId);

      if (!job) {
        throw new TelegramWarningException('Scheduled message not found');
      }

      await this.remindersQueue.removeRepeatableByKey(job.key);
      return '✅ Successfully removed scheduled message';
    } catch (error) {
      this.logger.error('Unschedule error:', error);
      throw new TelegramWarningException(
        'Failed to remove scheduled message. Please try again.',
      );
    }
  }

  private async handleListScheduled(): Promise<string> {
    try {
      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();

      const userJobs = repeatableJobs.filter((job) =>
        job.id?.startsWith(`${this.chatId}`),
      );

      if (userJobs.length === 0) {
        throw new TelegramWarningException('You have no scheduled messages');
      }

      const jobsList = userJobs
        .map((job) => {
          let [minutes, hours] = job.cron.split(' ');
          minutes = minutes.length < 2 ? `0${minutes}` : `${minutes}`;
          hours = hours.length < 2 ? `0${hours}` : `${hours}`;
          return `🕒 <b>${hours}:${minutes}</b> - ID: <code>${job.id}</code> 🕒`;
        })
        .join('\n');

      return `Your scheduled messages:\n${jobsList}\nYou can use message ID to remove it from schedule`;
    } catch (error) {
      this.logger.error('List scheduled error:', error);
      throw new TelegramWarningException(
        'Failed to list scheduled messages. Please try again.',
      );
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async checkInactiveUsers() {
    const inactiveChats = await this.chatService.getInactiveChats(
      this.inactiveMinutesThreshold,
    );
    for (const chat of inactiveChats) {
      await this.notificationsQueue.add('inactivity', {
        chatId: chat.chatId,
        type: 'inactivity',
        createdAt: new Date(),
      });
    }
  }
}

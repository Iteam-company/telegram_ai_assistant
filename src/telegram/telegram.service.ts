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
} from '../redis/interfaces/job.inteface';
import {
  TelegramException,
  TelegramUnknownCommandException,
  TelegramWarningException,
} from '../common/exceptions/telegram.exception';
import { TelegramUpdate } from './interfaces/telegram-update.interface';
import { TelegramMessage } from './interfaces/telegram-message.interface';
import { ChatService } from 'src/chat/chat.service';
import { CommandStateService } from 'src/redis/command-state.service';
import { CommandState } from '../redis/interfaces/command-state.interface';
import { TelegramMyChatMember } from './interfaces/telegram-my-chat-member.interface';
import { StringParser } from 'src/common/utils/string-parser';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly commands = new Map<
    string,
    (string?) => Promise<string> | string
  >();
  private chatId: number;
  private inactiveMinutesThreshold: number = 120;
  private usersDate: string;

  constructor(
    private httpService: HttpService,
    private openaiService: OpenaiService,
    private chatService: ChatService,
    @InjectQueue('messages')
    private messagesQueue: Queue<MessageJobData>,
    @InjectQueue('reminders')
    private remindersQueue: Queue<ReminderJobData>,
    @InjectQueue('notifications')
    private notificationsQueue: Queue<NotificationJobData>,
    private commandStateService: CommandStateService,
  ) {
    this.registerCommands();
  }

  private registerCommands() {
    this.commands.set('', this.handleAI);
    this.commands.set('/NOTACOMMAND', this.handleNotACommand);
    this.commands.set('/reset_history', this.handleHistoryReset);
    this.commands.set('/start', this.handleStart);
    this.commands.set('/help', this.handleHelp);
    this.commands.set('/cancel', this.handleCancel);
    this.commands.set('/nevermind', this.handleRemoveReminder);
    this.commands.set('/_rem_', this.handleRemoveReminder);
    this.commands.set('/unschedule', this.handleUnschedule);
    this.commands.set('/_del_', this.handleUnschedule);
    this.commands.set('/list_scheduled', this.handleListScheduled);
    this.commands.set('/once', this.handleOnce);
    this.commands.set('/daily', this.handleDaily);
    this.commands.set('/delayed', this.handleDelayed);
    this.commands.set('/remove_range', this.handleRemoveRange);
    this.commands.set('/remove_nearest', this.handleNearestReminder);
    this.commands.set('/find_and_delete', this.handleFindAndDeleteReminder);
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
      allowed_updates: [
        'message',
        'callback_query',
        'my_chat_member',
        'chat_member',
      ],
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
      update.message?.chat.id ||
      update.callback_query?.message.chat.id ||
      update.my_chat_member?.chat.id;

    this.usersDate = new Date(update.message?.date * 1000).toLocaleString();

    await this.chatService.updateLastActivity(this.chatId);

    if (update.message) {
      await this.handleMessage(update.message);
    } else if (update.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
    } else if (update.my_chat_member) {
      await this.handleBotBlocking(update.my_chat_member);
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

  private async handleBotBlocking(my_chat_member: TelegramMyChatMember) {
    if (my_chat_member.new_chat_member.status === 'kicked') {
      this.chatService.setInactive(this.chatId);
    }
  }

  private async handleTextMessages(text: string): Promise<boolean> {
    // Command/content parsing and choosing the right handler
    const { command, content } = this.parseCommand(text);
    const handler = this.commands.get(command);
    if (!handler) {
      throw new TelegramUnknownCommandException(command);
    }

    // Last command await for the responce (required data)
    const state = await this.commandStateService.getCommandState(this.chatId);
    if (state?.awaitingResponse && !(command && command === '/cancel')) {
      return await this.handleCommandResponse(state, text);
    }

    // Inline command type: '/schedule 12:20 Hello'
    if (content && this.supportsDirectInput(command)) {
      const responseMessage = await handler.call(this, content);
      return await this.sendMessage(responseMessage);
    }

    // Only command recieved. Awaiting required data from user: setting last command state
    if (!content && this.requiresResponse(command)) {
      await this.commandStateService.setCommandState(this.chatId, {
        command,
        awaitingResponse: true,
        expectedResponseType: this.getExpectedResponseType(command),
        timestamp: Date.now(),
      });
      return await this.sendMessage(this.getPromptForCommand(command));
    }

    // The rest cases
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
      // Command with this syntax: "/_del_123456789_12_34"
      const regexAndRest = StringParser.getRegexAndRest(
        trimmedInput,
        StringParser.underscoreCommandsRegex,
      );
      if (regexAndRest.first) {
        return { command: regexAndRest.first, content: regexAndRest.rest };
      }
      // Single command
      return { command: regexAndRest.rest, content: '' };
    }

    const commandAndRest = StringParser.getFirstAndRest(trimmedInput);
    return {
      command: commandAndRest.first,
      content: commandAndRest.rest,
    };
  }

  private requiresResponse(command: string): boolean {
    const requiresResponseCommands = [
      '/remind',
      '/nevermind',
      '/schedule',
      '/unschedule',
      '/once',
      '/daily',
      '/delayed',
    ];
    return requiresResponseCommands.includes(command);
  }

  private supportsDirectInput(command: string): boolean {
    const supportsDirectInputCommands = [
      '/remind',
      '/nevermind',
      '/schedule',
      '/unschedule',
      '/once',
      '/daily',
      '/delayed',
    ];
    return supportsDirectInputCommands.includes(command);
  }

  private getExpectedResponseType(command: string): string {
    const responseTypes = {
      '/remind': 'time_and_message',
      '/nevermind': 'id',
      '/schedule': 'time_and_message',
      '/unschedule': 'id',
      '/once': 'date_time_and_message',
      '/daily': 'time_and_message',
      '/delayed': 'minutes_and_message',
    };
    return responseTypes[command] || 'text';
  }

  private getPromptForCommand(command: string): string {
    const prompts = {
      '/remind':
        'Please enter time in minutes and message (e.g. "30 Call Mom"). Or click /cancel to abort the command.',
      '/nevermind':
        'Please enter the reminder-ID (e.g. "76"). Or click /cancel to abort the command.',
      '/schedule':
        'Please enter time (HH:MM) and message (e.g. "14:30 Daily standup"). Or click /cancel to abort the command.',
      '/unschedule':
        'Please enter the schedule-ID from schedule list (e.g. "123456789-12-35"). Or click /cancel to abort the command.',
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

  private async addDailyReminder(
    time: string,
    message: string,
  ): Promise<{ jobId: any; time: string }> {
    const [hours, minutes] = time.split(':').map(Number);
    const cronPattern = `${minutes} ${hours} * * *`;
    const formattedTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    const jobIdPart = `daily_${formattedTime.replace(':', '_')}`;
    const jobId = `${this.chatId}_${jobIdPart}`;

    const repeatableJobs = await this.remindersQueue.getRepeatableJobs();
    const existingJob = repeatableJobs.find((job) => job.id === jobId);
    if (existingJob) {
      await this.remindersQueue.removeRepeatableByKey(existingJob.key);
    }

    await this.remindersQueue.add(
      'daily-reminder',
      {
        chatId: this.chatId,
        message,
        type: 'daily',
        cronPattern,
        time: formattedTime,
        createdAt: new Date(),
      },
      {
        repeat: { cron: cronPattern },
        jobId,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    return { jobId: jobIdPart, time: formattedTime };
  }

  private async addOnceReminder(
    dateTime: Date,
    message: string,
  ): Promise<{ jobId: any; executeAt: Date }> {
    const delay = dateTime.getTime() - Date.now();

    const job = await this.messagesQueue.add(
      'delayed',
      {
        chatId: this.chatId,
        message,
        type: 'once',
        executeAt: dateTime,
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

    return { jobId: job.id, executeAt: dateTime };
  }

  private async addDelayedReminder(
    minutes: number,
    message: string,
  ): Promise<{ jobId: any; executeAt: Date }> {
    const delay = minutes * 60 * 1000;
    const executeAt = new Date(Date.now() + delay);

    const job = await this.messagesQueue.add(
      'delayed',
      {
        chatId: this.chatId,
        message,
        type: 'delayed',
        delay,
        executeAt,
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

    return { jobId: job.id, executeAt };
  }

  private async findUserReminders(range?: { start: Date; end: Date }) {
    // Get all user's reminders (both delayed and scheduled)
    const repeatableJobs = await this.remindersQueue.getRepeatableJobs();
    const dailyJobs = repeatableJobs.filter((job) =>
      job.id?.startsWith(`${this.chatId}`),
    );

    const delayedJobs = await this.messagesQueue.getJobs([
      'delayed',
      'waiting',
      'active',
    ]);
    const onceJobs = delayedJobs.filter(
      (job) =>
        job.data.chatId === this.chatId &&
        ['once', 'delayed'].includes(job.data.type),
    );

    // If range is provided, filter jobs within that range
    if (range) {
      return {
        dailyJobs: dailyJobs.filter((job) => {
          const [minutes, hours] = job.cron.split(' ');
          const jobTime = new Date();
          jobTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
          return jobTime >= range.start && jobTime <= range.end;
        }),
        onceJobs: onceJobs.filter((job) => {
          const executeAt = new Date(job.data.executeAt);
          return executeAt >= range.start && executeAt <= range.end;
        }),
      };
    }

    return { dailyJobs, onceJobs };
  }

  private async removeReminders(reminders: {
    dailyJobs: any[];
    onceJobs: any[];
  }) {
    const removedDaily = await Promise.all(
      reminders.dailyJobs.map((job) =>
        this.remindersQueue.removeRepeatableByKey(job.key),
      ),
    );

    const removedOnce = await Promise.all(
      reminders.onceJobs.map((job) => job.remove()),
    );

    return removedDaily.length + removedOnce.length;
  }

  private validateDateTime(date: Date): void {
    const validate = StringParser.validateDateTime(date);
    if (!validate) {
      throw new TelegramWarningException(
        'Please specify future date and time.',
      );
    }
  }

  private handleStart() {
    return `
Welcome to your AI Assistant! 🤖

I'm an AI-powered bot designed to help you manage your time and reminders while maintaining natural conversations. You can:

💬 Chat naturally with me about any topic
⏰ Set reminders using natural language
📅 Schedule daily events
🗓️ Plan one-time events
📋 Manage your reminders

Simply tell me what you need in plain language. For example:
- "Remind me to call mom in 30 minutes"
- "I need to take medicine every day at 9am"
- "Set a reminder for my dentist appointment next Monday at 2pm"
- "What reminders do I have?"
- "Remove my reminder about the gym tomorrow"

Type /help to see detailed instructions and available commands.

Let's get started! How can I assist you today?
`;
  }

  private handleHelp() {
    return `
🤖 AI Assistant Guide

I understand natural language and can help you with:

📱 Chat & Reminders:
- Just chat naturally about any topic
- Ask me to set reminders in plain language
- Request to modify or remove reminders
- Ask about your current reminders

Examples of natural interactions:
"Can you remind me to check my emails in 2 hours?"
➜ I'll set a reminder for you to check your emails in 2 hours.
   /delayed 120 Check emails

"I have yoga classes every morning at 7"
➜ I'll set up a daily reminder for your yoga classes.
   /daily 07:00 Time for yoga class

"What reminders do I have for tomorrow?"
➜ I'll check your scheduled reminders.
   /list_scheduled

"Remove all my reminders for tomorrow"
➜ I'll help you remove all reminders scheduled for tomorrow.
   /remove_range 01.01.2025 00:00 01.01.2025 23:59

"Remove my reminder about washing the car tomorrow"
➜ I'll help you find and remove the reminder about washing the car scheduled for tomorrow.
   /find_and_delete Car washing tomorrow

📋 Available Commands:
/daily - Set daily reminder (e.g., "09:30 Morning meeting")
/once - Set one-time reminder (e.g., "25.12.2024 10:00 Christmas breakfast")
/delayed - Set reminder in minutes (e.g., "30 Check laundry")
/list_scheduled - View all your reminders
/remove_nearest - Remove next upcoming reminder
/remove_range - Remove reminders in time range
/find_and_delete - Remove specific reminder by description
/reset_history - Clear chat history
/cancel - Cancel current command

Remember, you don't need to use these commands directly - just tell me what you need in natural language, and I'll handle the rest!

Is there anything specific you'd like help with?
`;
  }

  private handleNotACommand() {
    // TODO
    return 'This is not a command, but it is a tip🤗\nFor conversation with AI just...';
  }

  private async handleCancel() {
    const command = await this.commandStateService.getCommandState(this.chatId);
    await this.commandStateService.clearCommandState(this.chatId);
    return `The command '${command.command}' has been cancelled.`;
  }

  private async handleAI(content: string) {
    await this.sendChatAction('typing');
    const response = await this.openaiService.getAIResponseWithChatHistory(
      content,
      this.chatId,
      this.usersDate,
    );

    // Check if response contains a command
    const lines = response.split('\n');
    let commandLine = lines.find((line) => line.startsWith('/'));

    if (commandLine) {
      // Remove the command line from the response
      const userResponse = lines
        .filter((line) => !line.startsWith('/'))
        .join('\n');

      // Send the friendly response first
      await this.sendMessage(userResponse);

      // Execute the command
      const { command, content: commandContent } =
        this.parseCommand(commandLine);
      const handler = this.commands.get(command);
      if (handler) {
        const commandResponse = await handler.call(this, commandContent);
        return commandResponse;
      }
    }

    return response;
  }

  private async handleHistoryReset() {
    await this.chatService.clearConversationHistory(this.chatId);
    return 'Conversation history has been reset.';
  }

  private async handleOnce(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please provide date, time and message. Format: /once DD.MM.YYYY HH:MM Your message or HH:MM Your message',
      );
    }

    const { first: dateTimeStr, rest: message } =
      StringParser.getRegexAndRest(content);
    if (!message) {
      throw new TelegramWarningException('Please provide a message');
    }

    const dateTime = StringParser.parseDateTime(dateTimeStr);
    this.validateDateTime(dateTime);

    const { jobId, executeAt } = await this.addOnceReminder(dateTime, message);

    return `✅ One-time reminder set:\n"${message}"\nfor ${executeAt.toLocaleString()}\nTo remove click: /_rem_${jobId}`;
  }

  private async handleDaily(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please provide time and message. Format: /daily HH:MM Your message',
      );
    }

    const { first: time, rest: message } =
      StringParser.getFirstAndRest(content);
    if (!message) {
      throw new TelegramWarningException('Please provide a message');
    }

    if (!time.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
      throw new TelegramWarningException(
        'Invalid time format. Please use HH:MM format (e.g., 14:30)',
      );
    }

    const { jobId, time: formattedTime } = await this.addDailyReminder(
      time,
      message,
    );

    return `✅ Daily reminder set:\n"${message}"\nfor ${formattedTime} every day\nTo remove click: /_del_${jobId}`;
  }

  private async handleDelayed(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please specify delay in minutes and message. Format: /delayed 30 Your message',
      );
    }

    const { first: minutesStr, rest: message } =
      StringParser.getFirstAndRest(content);
    if (!message) {
      throw new TelegramWarningException('Please provide a message');
    }

    const minutes = parseInt(minutesStr);
    if (isNaN(minutes) || minutes <= 0) {
      throw new TelegramWarningException(
        'Please specify valid delay in minutes',
      );
    }

    const { jobId, executeAt } = await this.addDelayedReminder(
      minutes,
      message,
    );

    return `✅ Reminder set:\n"${message}"\nfor ${executeAt.toLocaleString()}\nTo remove click: /_rem_${jobId}`;
  }

  private async handleRemoveReminder(jobId: string): Promise<string> {
    if (!jobId) {
      throw new TelegramWarningException(
        'Please provide reminder ID. Format: /_rem_123456',
      );
    }

    try {
      const job = await this.messagesQueue.getJob(jobId);

      if (!job) {
        throw new TelegramWarningException(
          'Reminder not found. It might have been already completed or removed.',
        );
      }

      if (job.data.chatId !== this.chatId) {
        throw new TelegramWarningException(
          "This reminder is from other user's chat. Please try to enter correct ID.",
        );
      }

      const state = await job.getState();
      if (state === 'completed') {
        throw new TelegramWarningException(
          'This reminder has already been sent and cannot be removed.',
        );
      }

      await job.remove();
      return '✅ Successfully removed reminder';
    } catch (error) {
      if (error instanceof TelegramWarningException) {
        throw error;
      }
      this.logger.error('Remove reminder error:', error);
      throw new TelegramWarningException(
        'Failed to remove reminder. Please try again.',
      );
    }
  }

  private async handleUnschedule(jobIdPart: string): Promise<string> {
    try {
      const jobId = `${this.chatId}_${jobIdPart}`;

      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();
      const job = repeatableJobs.find((j) => j.id === jobId);

      if (!job) {
        throw new TelegramWarningException(
          'Scheduled message not found. Please try to enter correct ID.',
        );
      }

      await this.remindersQueue.removeRepeatableByKey(job.key);
      return '✅ Successfully removed scheduled message';
    } catch (error) {
      if (error instanceof TelegramWarningException) {
        throw error;
      }
      this.logger.error('Unschedule error:', error);
      throw new TelegramWarningException(
        'Failed to remove scheduled message. Please try again.',
      );
    }
  }

  private async handleListScheduled(): Promise<string> {
    try {
      // Get daily reminders
      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();
      const dailyJobs = repeatableJobs.filter((job) =>
        job.id?.startsWith(`${this.chatId}`),
      );

      // Get one-time reminders
      const delayedJobs = await this.messagesQueue.getJobs([
        'delayed',
        'waiting',
        'active',
      ]);
      const onceJobs = delayedJobs.filter(
        (job) =>
          job.data.chatId === this.chatId &&
          ['once', 'delayed'].includes(job.data.type),
      );

      if (dailyJobs.length === 0 && onceJobs.length === 0) {
        throw new TelegramWarningException('You have no reminders');
      }

      let responseMessage = '';

      // Process daily reminders
      if (dailyJobs.length > 0) {
        const repeatableDelayed = await this.remindersQueue.getDelayed();

        const dailyJobsWithData = await Promise.all(
          dailyJobs.map(async (job) => {
            const relatedJob = repeatableDelayed.find(
              (delayed) =>
                delayed.opts.repeat.key ===
                `daily-reminder:${job.id}:::${job.cron}`,
            );

            const jobData = relatedJob.data;
            const { rest: jobIdPart } = StringParser.getFirstAndRest(
              job.id,
              '_',
            );
            const [hours, minutes] = jobData.time.split(':').map(Number);

            return {
              timeForSort: hours * 60 + minutes,
              time: jobData.time,
              id: jobIdPart,
              message: jobData.message,
            };
          }),
        );

        // Sort daily jobs by time
        const sortedDailyJobs = dailyJobsWithData.sort(
          (a, b) => a.timeForSort - b.timeForSort,
        );

        responseMessage +=
          '📅 <u>Daily reminders:</u>\n' +
          sortedDailyJobs
            .map(
              (job) =>
                `🕒 <b>${job.time}:</b>\n<i>"${job.message}"</i>\n🗑/_del_${job.id}`,
            )
            .join('\n');
      }

      // Process one-time reminders
      if (onceJobs.length > 0) {
        const onceJobsWithData = onceJobs.map((job) => ({
          executeAt: job.data.executeAt,
          timeForSort: new Date(job.data.executeAt).getTime(),
          message: job.data.message,
          id: job.id,
        }));

        // Sort one-time jobs by execution time
        const sortedOnceJobs = onceJobsWithData.sort(
          (a, b) => a.timeForSort - b.timeForSort,
        );

        if (responseMessage) responseMessage += '\n\n';
        responseMessage +=
          '📍 <u>One-time reminders:</u>\n' +
          sortedOnceJobs
            .map(
              (job) =>
                `🕒 <b>${new Date(job.executeAt).toLocaleString()}:</b>\n<i>"${
                  job.message
                }"</i>\n🗑/_rem_${job.id}`,
            )
            .join('\n');
      }

      return (
        responseMessage +
        '\n\n<u>Use commands under the messages to remove them from schedule</u>'
      );
    } catch (error) {
      if (error instanceof TelegramWarningException) {
        throw error;
      }
      this.logger.error('List reminders error:', error);
      throw new TelegramWarningException(
        'Failed to list reminders. Please try again.',
      );
    }
  }

  private async handleBulkRemoveReminders(range: {
    start: Date;
    end: Date;
  }): Promise<string> {
    const reminders = await this.findUserReminders(range);
    const count = await this.removeReminders(reminders);
    return `✅ Successfully removed ${count} reminder${count !== 1 ? 's' : ''}.`;
  }

  private async handleNearestReminder(): Promise<string> {
    const { dailyJobs, onceJobs } = await this.findUserReminders();

    const now = new Date();
    let nearest: { job: any; time: Date; type: 'daily' | 'once' } | null = null;

    // Check daily jobs
    dailyJobs.forEach((job) => {
      const [minutes, hours] = job.cron.split(' ');
      const jobTime = new Date();
      jobTime.setHours(parseInt(hours), parseInt(minutes), 0, 0);
      if (jobTime < now) jobTime.setDate(jobTime.getDate() + 1);

      if (!nearest || jobTime < nearest.time) {
        nearest = { job, time: jobTime, type: 'daily' };
      }
    });

    // Check once jobs
    onceJobs.forEach((job) => {
      const jobTime = new Date(job.data.executeAt);
      if (jobTime > now && (!nearest || jobTime < nearest.time)) {
        nearest = { job, time: jobTime, type: 'once' };
      }
    });

    if (!nearest) {
      throw new TelegramWarningException('No upcoming reminders found.');
    }

    if (nearest.type === 'daily') {
      await this.remindersQueue.removeRepeatableByKey(nearest.job.key);
    } else {
      await nearest.job.remove();
    }

    return `✅ Successfully removed the nearest reminder scheduled for ${nearest.time.toLocaleString()}.`;
  }

  private async handleRemoveRange(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please provide start and end dates. Format: /remove_range DD.MM.YYYY HH:MM DD.MM.YYYY HH:MM',
      );
    }

    //TODO
    const firstAndRest = StringParser.getFirstAndRest(content, ' ', 2);
    const start = StringParser.parseDateTime(firstAndRest.first);
    const end = StringParser.parseDateTime(firstAndRest.rest);

    return await this.handleBulkRemoveReminders({ start, end });
  }

  private async getFormattedRemindersForAI(): Promise<string> {
    const { dailyJobs, onceJobs } = await this.findUserReminders();
    const delayedJobs = await this.remindersQueue.getDelayed();

    let remindersList = 'Current reminders:\n';

    // Format daily reminders
    if (dailyJobs.length > 0) {
      remindersList += '\nDaily reminders:\n';
      await Promise.all(
        dailyJobs.map(async (job) => {
          const relatedJob = delayedJobs.find(
            (delayed) =>
              delayed.opts.repeat.key ===
              `daily-reminder:${job.id}:::${job.cron}`,
          );
          const jobData = relatedJob.data;
          const { rest: jobId } = StringParser.getFirstAndRest(job.id, '_');
          remindersList += `- Daily at ${jobData.time}: "${jobData.message}" (ID: ${jobId})\n`;
        }),
      );
    }

    // Format one-time reminders
    if (onceJobs.length > 0) {
      remindersList += '\nOne-time reminders:\n';
      onceJobs.forEach((job) => {
        const executeAt = new Date(job.data.executeAt);
        remindersList += `- ${executeAt.toLocaleString()}: "${job.data.message}" (ID: ${job.id})\n`;
      });
    }

    return remindersList;
  }

  private async handleFindAndDeleteReminder(
    description: string,
  ): Promise<string> {
    const reminders = await this.getFormattedRemindersForAI();

    const prompt = `Given this list of user's reminders:
  ${reminders}
  
  User wants to delete this reminder: "${description}"
  Analyze the reminders and determine which one matches the user's description.
  If you find a matching reminder, respond with ONLY the command to delete it:
  For daily reminders use: /_del_ID
  For one-time reminders use: /_rem_ID
  If no matching reminder is found, respond with: NO_MATCH
  If multiple reminders might match, respond with: MULTIPLE_MATCHES`;

    const aiResponse = await this.openaiService.getAIDecision(prompt);

    if (aiResponse === 'NO_MATCH') {
      throw new TelegramWarningException(
        'I could not find a reminder matching your description. Please check your current reminders with /list_scheduled',
      );
    }

    if (aiResponse === 'MULTIPLE_MATCHES') {
      return `I found multiple reminders that might match your description. Please check the list and use the specific ID to delete:\n${reminders}`;
    }

    // Execute the deletion command
    const { command, content } = this.parseCommand(aiResponse);
    const handler = this.commands.get(command);
    if (handler) {
      return await handler.call(this, content);
    }

    throw new TelegramWarningException(
      'Something went wrong. Please try again.',
    );
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

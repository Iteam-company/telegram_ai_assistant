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
  TelegramWarningException,
} from '../common/exceptions/telegram.exception';
import { TelegramUpdate } from './interfaces/telegram-update.interface';
import { TelegramMessage } from './interfaces/telegram-message.interface';
import { ChatService } from 'src/chat/chat.service';
import { CommandStateService } from 'src/redis/command-state.service';
import { CommandState } from './interfaces/command-state.interface';
import { TelegramMyChatMember } from './interfaces/telegram-my-chat-member.interface';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly commands = new Map<
    string,
    (string?) => Promise<string> | string
  >();
  private chatId: number;
  private inactiveMinutesThreshold: number = 5;

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
    this.commands.set('/NOTACOMMAND', this.handleNotACommand);
    this.commands.set('/reset_history', this.handleHistoryReset);
    this.commands.set('/start', this.handleStart);
    this.commands.set('/help', this.handleHelp);
    this.commands.set('/cancel', this.handleCancel);
    this.commands.set('/schedule', this.handleSchedule);
    this.commands.set('/remind', this.handleReminder);
    this.commands.set('/nevermind', this.handleRemoveReminder);
    this.commands.set('/_rem_', this.handleRemoveReminder);
    this.commands.set('/unschedule', this.handleUnschedule);
    this.commands.set('/_del_', this.handleUnschedule);
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
      const match = trimmedInput.match(/^(\/\_[a-zA-Z]+\_)(\S+)$/);
      if (match) {
        return { command: match[1], content: match[2] };
      }
      // Single command
      return { command: trimmedInput, content: '' };
    }

    return {
      command: trimmedInput.slice(0, firstSpaceIndex),
      content: trimmedInput.slice(firstSpaceIndex + 1),
    };
  }

  private getFirstAndRest(input: string): { first: string; rest: string } {
    const trimmedInput = input.trim();
    const firstSpaceIndex = trimmedInput.indexOf(' ');
    return {
      first: trimmedInput.slice(0, firstSpaceIndex),
      rest: trimmedInput.slice(firstSpaceIndex + 1),
    };
  }

  private requiresResponse(command: string): boolean {
    const requiresResponseCommands = [
      '/remind',
      '/nevermind',
      '/schedule',
      '/unschedule',
    ];
    return requiresResponseCommands.includes(command);
  }

  private supportsDirectInput(command: string): boolean {
    const supportsDirectInputCommands = [
      '/remind',
      '/nevermind',
      '/schedule',
      '/unschedule',
    ];
    return supportsDirectInputCommands.includes(command);
  }

  private getExpectedResponseType(command: string): string {
    const responseTypes = {
      '/remind': 'time_and_message',
      '/nevermind': 'id',
      '/schedule': 'time_and_message',
      '/unschedule': 'id',
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

  private handleStart() {
    return "Welcome👋! I am a bot🤖 powered by ChatGPT. Ask me anything!\nType '/help' to get a list of commands or click 'menu' for a shortcuts.";
  }

  private handleHelp() {
    return `
<u>Bot features:</u> conversation with AI, setting/unsetting/listing of everyday scheduled reminders, setting/unsetting one-time reminders.

For conversation with AI just type your messages in chat, just like chating with real person.
This bot supports only text inputs. Commands support oneline input:
<code>USER> "/remind 5 Tea is ready!"
BOT> *Bot conformation*</code>
and/or two-step input:
<code>USER> "/remind"
BOT> *TIP FOR COMMAND USING*
USER> "5 Tea is ready!"
BOT> *Bot conformation*</code>

<u>Command list:</u>
/help - Show all available commands 🤖

/schedule [HH:MM] [message] - Set a daily reminder (e.g., <code>"/schedule 09:30 Morning meeting"</code>) 🕒
/list_scheduled - View all your scheduled daily messages 📋
/_del_[ID] - Remove a scheduled message by clicking the command under it 🗑

/remind [minutes] [message] - Set a one-time reminder (e.g., <code>"/remind 30 Take medicine"</code>) ⏰
/_rem_[ID] - Remove a reminder by clicking the command under it ❌

/reset_history - Clear chat history with AI 🧹
/cancel - Cancel current command 🚫
`;
  }

  private handleNotACommand() {
    return 'This is not a command, but it is a tip🤗\nFor conversation with AI just';
  }

  private async handleCancel() {
    const command = await this.commandStateService.getCommandState(this.chatId);
    await this.commandStateService.clearCommandState(this.chatId);
    return `The command '${command.command}' has been cancelled.`;
  }

  private async handleAI(content) {
    await this.sendChatAction('typing');
    const gptResponse = await this.openaiService.getResponseWithChatHistory(
      content,
      this.chatId,
    );
    return gptResponse;
  }

  private async handleHistoryReset() {
    await this.chatService.clearConversationHistory(this.chatId);
    return 'Conversation history has been reset.';
  }

  private async handleReminder(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please specify delay in minutes and message. Format: /remind 30 Your message',
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
        'Please specify delay in minutes. Format: /remind 30 Your message',
      );
    }

    try {
      const job = await this.messagesQueue.add(
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

      return `✅ Reminder set for ${delayStr} minutes from now\nTo remove click: /_rem_${job.id}`;
    } catch (error) {
      this.logger.error('Reminder error:', error);
      throw new TelegramWarningException(
        'Failed to set reminder. Please try again.',
      );
    }
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

  private async handleSchedule(content: string): Promise<string> {
    if (!content) {
      throw new TelegramWarningException(
        'Please provide both time and message. Format: /schedule HH:MM Your message',
      );
    }

    const { first: time, rest: message } = this.getFirstAndRest(content);

    if (!message) {
      throw new TelegramWarningException(
        'Please provide a message to schedule',
      );
    }

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

    const jobId = `${this.chatId}_${formatedHours}${formatedMinutes}`;

    try {
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

      const action = existingJob ? 'updated' : 'scheduled';
      return `✅ Successfully ${action} message:\n"${message}"\nfor ${time} daily\nTo delete click: /_del_${jobId}`;
    } catch (error) {
      this.logger.error('Schedule error:', error);
      throw new TelegramWarningException(
        'Failed to schedule message. Please try again.',
      );
    }
  }

  private async handleUnschedule(jobId: string): Promise<string> {
    if (!jobId.startsWith(this.chatId.toString())) {
      throw new TelegramWarningException(
        "This ID is from other user's chat. Please try to enter correct ID.",
      );
    }

    try {
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
      const repeatableJobs = await this.remindersQueue.getRepeatableJobs();

      const userJobs = repeatableJobs.filter((job) =>
        job.id?.startsWith(`${this.chatId}`),
      );

      if (userJobs.length === 0) {
        throw new TelegramWarningException('You have no scheduled messages');
      }

      const jobsWithData = await Promise.all(
        userJobs.map(async (job) => {
          const delayedJobs = await this.remindersQueue.getDelayed();
          const relatedJob = delayedJobs.find(
            (delayed) =>
              delayed.opts.repeat.key ===
              `daily-reminder:${job.id}:::${job.cron}`,
          );

          let message = '';
          if (relatedJob) {
            const jobData = relatedJob.data;
            message = jobData.message;
          }

          let [minutes, hours] = job.cron.split(' ');
          minutes = minutes.length < 2 ? `0${minutes}` : `${minutes}`;
          hours = hours.length < 2 ? `0${hours}` : `${hours}`;

          return {
            time: `${hours}:${minutes}`,
            id: job.id,
            message,
          };
        }),
      );

      const jobsList = jobsWithData
        .map(
          (job) =>
            `🕒 <b>${job.time}:</b>\n<i>"${job.message}"</i>\n🗑/_del_${job.id}`,
        )
        .join('\n');

      return `Your scheduled messages:\n${jobsList}\n<u>Use commands under the messages to remove it from schedule</u>`;
    } catch (error) {
      if (error instanceof TelegramWarningException) {
        throw error;
      }
      this.logger.error('List scheduled error:', error);
      throw new TelegramWarningException(
        'Failed to list scheduled messages. Please try again.',
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
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

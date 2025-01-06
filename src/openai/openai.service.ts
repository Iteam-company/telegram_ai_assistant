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

  // In OpenaiService, add the system prompt
  private readonly SYSTEM_PROMPT = `You are a helpful AI assistant integrated with a telegram bot. You can both chat naturally and help users manage their reminders and schedules. You have access to these commands:

/once [DD.MM.YYYY HH:MM] [message] - For one-time reminders with specific date and time
/daily [HH:MM] [message] - For daily recurring reminders
/delayed [minutes] [message] - For reminders after X minutes
/list_scheduled - To show all reminders

When users express intent to set reminders or schedules in natural language, analyze their request and respond with TWO parts:
1. A friendly confirmation of understanding
2. The appropriate command in a new line

Examples:
User: "remind me to call mom in 30 minutes"
Response: I'll set a reminder for you to call your mom in 30 minutes.
/delayed 30 Call mom

User: "I need to take medicine every day at 9am"
Response: I'll set a daily reminder for your medicine.
/daily 09:00 Take medicine

User: "remind me about the meeting tomorrow at 3pm"
Response: I'll set a reminder for your meeting tomorrow at 3 PM.
/once 07.01.2024 15:00 Meeting reminder

User: "what are my current reminders?"
Response: I'll show you all your scheduled reminders.
/list_scheduled

For all other conversations, engage naturally and helpfully. Always maintain a friendly and professional tone.`;

  private readonly REMINDER_SYSTEM_PROMPT = `You are a helpful AI assistant delivering a scheduled reminder. Your responses should be:
1. Contextual to the reminder's purpose
2. Encouraging and positive
3. Provide relevant suggestions when appropriate

Examples:
Reminder: "Take medicine"
Response: "Time to take your medicine! Remember to take it with water and keep track of your doses. Stay healthy! 💊"

Reminder: "Call mom"
Response: "Hey! This is your reminder to call your mom. Don't forget to ask about her day and share your recent news. Keep those family bonds strong! 📞❤️"

Reminder: "Team meeting"
Response: "Time for your team meeting! Don't forget to bring up any important points you've noted. Good luck with your discussion! 🤝"

Keep responses concise but friendly, and always relevant to the reminder's context.`;

  async createResponse(messages: Omit<Message, 'timestamp'>[]) {
    const completion = await this.openai.chat.completions.create({
      messages: messages,
      model: this.MODEL,
    });
    return (
      completion.choices[0].message.content ||
      'Sorry, I could not process that.'
    );
  }

  async getAIResponse(message: string): Promise<string> {
    try {
      const dialogPart: {
        role: 'user' | 'assistant' | 'system';
        content: string;
      }[] = [
        { role: 'system', content: this.REMINDER_SYSTEM_PROMPT },
        { role: 'user', content: message },
      ];

      const response = await this.createResponse(dialogPart);
      return response;
    } catch (error) {
      this.logger.error('OpenAI API Error:', error);
      const status = error.response?.status || error.status || 500;
      throw new OpenAIException(error.message, error, status);
    }
  }

  async getAIResponseWithChatHistory(
    message: string,
    chatId: number,
  ): Promise<string> {
    try {
      const dialogPart: {
        role: 'user' | 'assistant' | 'system';
        content: string;
      }[] = [{ role: 'system', content: this.SYSTEM_PROMPT }];

      this.chatHistory = await this.chatService.getConversationHistory(chatId);

      // Add history after system prompt
      dialogPart.push(...this.chatHistory);
      // Add current message
      dialogPart.push({ role: 'user', content: message });

      const response = await this.createResponse(dialogPart);

      // Save only user-assistant exchanges, not the system prompt
      this.chatService.pushMessagesWithMaxHistory(
        chatId,
        [
          { role: 'user', content: message },
          { role: 'assistant', content: response },
        ],
        this.MAX_HISTORY,
      );

      return response;
    } catch (error) {
      this.logger.error('OpenAI API Error:', error);
      const status = error.response?.status || error.status || 500;
      throw new OpenAIException(error.message, error, status);
    }
  }
}

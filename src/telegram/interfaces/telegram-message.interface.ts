import { TelegramChat } from './telegram-chat.interface';
import { TelegramUser } from './telegram-user.interface';

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: Array<any>;
  document?: any;
}

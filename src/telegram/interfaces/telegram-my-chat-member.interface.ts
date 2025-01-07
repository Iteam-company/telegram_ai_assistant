import { TelegramMessage } from './telegram-message.interface';
import { TelegramUser } from './telegram-user.interface';

export interface TelegramMyChatMember extends TelegramMessage {
  old_chat_member?: {
    user: TelegramUser;
    status: string;
    until_date?: number;
  };
  new_chat_member?: {
    user: TelegramUser;
    status: string;
    until_date?: number;
  };
}

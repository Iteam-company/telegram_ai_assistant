import { TelegramMessage } from './telegram-message.interface';
import { TelegramMyChatMember } from './telegram-my-chat-member.interface';

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: any;
  my_chat_member?: TelegramMyChatMember;
}

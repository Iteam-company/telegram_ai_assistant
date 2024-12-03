import { TelegramMessage } from './telegram-message.interface';

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: any;
}

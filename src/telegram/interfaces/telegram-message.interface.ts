export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  date: number;
  text?: string;
  photo?: Array<any>;
  document?: any;
}

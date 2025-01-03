export interface BaseJobData {
  chatId: number;
  createdAt: Date;
}

export interface MessageJobData extends BaseJobData {
  message: string;
  type: 'delayed' | 'ai';
}

export interface ReminderJobData extends BaseJobData {
  message: string;
  type: 'daily' | 'ai';
  cronPattern?: string;
  time?: string;
}

export interface NotificationJobData extends BaseJobData {
  type: 'inactivity' | 'custom';
  message?: string;
}

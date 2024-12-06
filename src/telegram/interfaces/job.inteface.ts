export interface BaseJobData {
  chatId: number;
  createdAt: Date;
}

export interface MessageJobData extends BaseJobData {
  message: string;
  type: 'direct' | 'delayed';
}

export interface ReminderJobData extends BaseJobData {
  message: string;
  type: 'daily' | 'custom';
  cronPattern?: string;
  time?: string;
}

export interface NotificationJobData extends BaseJobData {
  type: 'inactivity' | 'morning' | 'evening';
  message?: string;
}

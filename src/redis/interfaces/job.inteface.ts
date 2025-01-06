export interface BaseJobData {
  chatId: number;
  message?: string;
  createdAt: Date;
}

export type MessageJobData = DelayedJobData | OneTimeJobData;

export type ReminderJobData = DailyJobData;

export interface OneTimeJobData extends BaseJobData {
  type: 'once' | 'ai' | 'custom';
  executeAt: Date;
}

export interface DailyJobData extends BaseJobData {
  type: 'daily' | 'ai' | 'custom';
  cronPattern: string;
  time: string;
}

export interface DelayedJobData extends BaseJobData {
  type: 'delayed' | 'ai' | 'custom';
  delay?: number;
  executeAt?: Date;
}

export interface NotificationJobData extends BaseJobData {
  type: 'inactivity' | 'ai' | 'custom';
}

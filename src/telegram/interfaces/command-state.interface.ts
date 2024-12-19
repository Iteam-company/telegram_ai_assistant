export interface CommandState {
  command: string;
  awaitingResponse: boolean;
  expectedResponseType?: string;
  timestamp: number;
  params?: Record<string, any>;
}

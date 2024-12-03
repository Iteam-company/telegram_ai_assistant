export interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  method: string;
  body?: any;
  stack?: string;
}

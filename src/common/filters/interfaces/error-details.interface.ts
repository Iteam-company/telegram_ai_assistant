export interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string;
  method: string;
  body?: any;
  stack?: string;
}

export interface ErrorDetails {
  type: string;
  error: string;
  status: number;
  details?: any;
  stack?: string;
  isWarning?: boolean;
}

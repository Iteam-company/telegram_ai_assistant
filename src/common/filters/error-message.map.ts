import { ErrorDetails } from './interfaces/error-details.interface';

export class ErrorMessageMap {
  private static errorMessages = new Map<string, string>([
    // OpenAI errors
    [
      'OpenAIException:rate_limit_exceeded',
      '⏳ Rate limit exceeded. Please try again later.',
    ],
    [
      'OpenAIException:context_length_exceeded',
      '📝 Message is too long. Please send a shorter message.',
    ],
    [
      'OpenAIException:invalid_api_key',
      '🔑 Authentication error. Please contact the administrator.',
    ],
    [
      'OpenAIException:insufficient_quota',
      '💰 Usage limit reached. Please try again tomorrow or contact the administrator.',
    ],
    [
      'OpenAIException:invalid_request_error',
      '❌ Invalid request to AI service.',
    ],
    [
      'OpenAIException:model_not_found',
      '🤖 Selected AI model is currently unavailable.',
    ],
    [
      'OpenAIException:server_error',
      '🔧 AI service is experiencing issues. Please try again later.',
    ],

    // Telegram errors
    [
      'TelegramException:UNKNOWN_COMMAND',
      "📃 Unknown command received. Please type '/help' to get list of commands.",
    ],
    ['TelegramException:FORBIDDEN', '🚫 Bot was blocked by the user or chat.'],
    [
      'TelegramException:TOO_MANY_REQUESTS',
      '⏳ Too many requests. Please wait a moment.',
    ],
    ['TelegramException:BAD_REQUEST', '❌ Invalid request to Telegram.'],
    ['TelegramException:UNAUTHORIZED', '🔑 Bot token is invalid.'],
    [
      'TelegramException:FLOOD_WAIT',
      '⌛ Please wait before sending more messages.',
    ],
    [
      'TelegramException:MESSAGE_TOO_LONG',
      '📝 Message is too long for Telegram.',
    ],
    ['TelegramException:CHAT_NOT_FOUND', '🔍 Chat was not found.'],
    [
      'TelegramException:USER_DEACTIVATED',
      '👤 User has deleted their account.',
    ],
    ['TelegramException:BLOCKED_BY_USER', '🚫 User has blocked the bot.'],
    ['TelegramException:RESPONSE_TIMEOUT', '⏱️ Telegram response timeout.'],

    // Mongoose errors
    ['MongooseError:ValidationError', '❌ Data validation failed.'],
    ['MongooseError:CastError', '❌ Invalid data format.'],
    ['MongooseError:DocumentNotFoundError', '🔍 Document not found.'],
    ['MongooseError:DuplicateKeyError', '⚠️ This record already exists.'],
    [
      'MongooseError:VersionError',
      '📝 Document was modified by another request.',
    ],
    ['MongooseError:ParallelSaveError', '⚠️ Parallel save conflict detected.'],
    ['MongooseError:StrictModeError', '❌ Invalid field in document.'],
    ['MongooseError:DisconnectedError', '🔌 Database connection lost.'],
    ['MongooseError:TimeoutError', '⌛ Database operation timeout.'],

    // Default HTTP status errors
    ['default:400', '❌ Bad request. Please try again.'],
    [
      'default:401',
      '🔑 Authentication error. Please contact the administrator.',
    ],
    ['default:403', '🚫 Access forbidden.'],
    ['default:404', '🔍 Resource not found.'],
    ['default:429', '⏳ Too many requests. Please wait a minute.'],
    ['default:500', '🔧 Server error. Please try again later.'],
    ['default:502', '🌐 Bad gateway. Please try again later.'],
    ['default:503', '🏥 Service temporarily unavailable.'],
    ['default:504', '⌛ Gateway timeout. Please try again later.'],
  ]);

  static getUserFriendlyMessage(errorDetails: ErrorDetails): string {
    const specificKey = `${errorDetails.type}:${errorDetails.error}`;
    if (this.errorMessages.has(specificKey)) {
      return this.errorMessages.get(specificKey);
    }

    const defaultKey = `default:${errorDetails.status}`;
    return (
      this.errorMessages.get(defaultKey) ||
      '❌ Something went wrong. Please try again later.'
    );
  }
}

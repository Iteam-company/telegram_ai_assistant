import { BullModule } from '@nestjs/bull';
import { MessagesProcessor } from '../redis/processors/telegram.message.processor';
import { NotificationsProcessor } from '../redis/processors/telegram.notifications.processor';
import { RemindersProcessor } from '../redis/processors/telegram.reminders.processor';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { OpenaiModule } from 'src/openai/openai.module';
import { Module } from '@nestjs/common';
import { ChatModule } from 'src/chat/chat.module';
import { RedisModule } from 'src/redis/redis.module';
import { CleanupService } from '../redis/bull-cleanup.service';

@Module({
  imports: [
    ConfigModule,
    OpenaiModule,
    ChatModule,
    RedisModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        timeout: 5000,
        maxRedirects: 5,
        baseURL: (() => {
          const token = configService.get<string>('TG_TOKEN');
          const tgUrlDraft = configService.get<string>('TG_URL');
          return tgUrlDraft.replace('<token>', token);
        })(),
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'messages' },
      { name: 'reminders' },
      { name: 'notifications' },
    ),
  ],
  providers: [
    TelegramService,
    MessagesProcessor,
    RemindersProcessor,
    NotificationsProcessor,
    CleanupService,
  ],
  controllers: [TelegramController],
})
export class TelegramModule {}

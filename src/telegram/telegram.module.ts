import { BullModule } from '@nestjs/bull';
import { MessagesProcessor } from './processors/telegram.message.processor';
import { NotificationsProcessor } from './processors/telegram.notifications.processor';
import { RemindersProcessor } from './processors/telegram.reminders,processor';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { OpenaiModule } from 'src/openai/openai.module';
import { Module } from '@nestjs/common';

@Module({
  imports: [
    ConfigModule,
    OpenaiModule,
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
  ],
  controllers: [TelegramController],
})
export class TelegramModule {}

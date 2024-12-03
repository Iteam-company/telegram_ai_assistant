import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { OpenaiModule } from 'src/openai/openai.module';

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
  ],
  providers: [TelegramService],
  controllers: [TelegramController],
})
export class TelegramModule {}

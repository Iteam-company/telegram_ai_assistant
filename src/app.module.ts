import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TelegramModule } from './telegram/telegram.module';
import { ConfigModule } from '@nestjs/config';
import { OpenaiModule } from './openai/openai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TelegramModule,
    OpenaiModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [AppService],
})
export class AppModule {}

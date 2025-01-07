import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OpenaiService } from './openai.service';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  imports: [ConfigModule, ChatModule],
  providers: [OpenaiService],
  exports: [OpenaiService],
})
export class OpenaiModule {}

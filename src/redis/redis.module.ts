import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from 'redis';
import { CommandStateService } from './command-state.service';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: async (configService: ConfigService) => {
        const client = createClient({
          url: `redis://${configService.get('REDIS_HOST', 'localhost')}:${configService.get('REDIS_PORT', 6379)}`,
        });
        await client.connect();
        return client;
      },
      inject: [ConfigService],
    },
    CommandStateService,
  ],
  exports: [CommandStateService],
})
export class RedisModule {}

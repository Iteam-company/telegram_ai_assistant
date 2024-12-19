import { Inject, Injectable } from '@nestjs/common';
import { RedisClientType } from 'redis';
import { CommandState } from '../telegram/interfaces/command-state.interface';

@Injectable()
export class CommandStateService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: RedisClientType,
  ) {}

  private getKey(chatId: number): string {
    return `command_state:${chatId}`;
  }

  async setCommandState(
    chatId: number,
    state: CommandState,
    ttl: number = 300,
  ): Promise<void> {
    const key = this.getKey(chatId);

    const redisState = {
      command: state.command,
      awaitingResponse: String(state.awaitingResponse),
      expectedResponseType: state.expectedResponseType || '',
      timestamp: String(Date.now()),
      params: JSON.stringify(state.params || {}),
    };

    await this.redis.hSet(key, redisState);
    await this.redis.expire(key, ttl);
  }

  async getCommandState(chatId: number): Promise<CommandState | null> {
    const key = this.getKey(chatId);
    const state = await this.redis.hGetAll(key);

    if (!Object.keys(state).length) {
      return null;
    }

    return {
      command: state.command,
      awaitingResponse: state.awaitingResponse === 'true',
      expectedResponseType: state.expectedResponseType || undefined,
      timestamp: parseInt(state.timestamp),
      params: JSON.parse(state.params || '{}'),
    } as CommandState;
  }

  async clearCommandState(chatId: number): Promise<void> {
    const key = this.getKey(chatId);
    await this.redis.del(key);
  }

  async updateCommandState(
    chatId: number,
    updates: Partial<CommandState>,
  ): Promise<void> {
    const currentState = await this.getCommandState(chatId);
    if (currentState) {
      await this.setCommandState(chatId, {
        ...currentState,
        ...updates,
      });
    }
  }
}

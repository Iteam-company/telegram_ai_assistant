import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Chat, Message } from './chat.schema';

@Injectable()
export class ChatService {
  constructor(@InjectModel(Chat.name) private chatModel: Model<Chat>) {}

  async findOrCreateChat(chatId: number): Promise<Chat> {
    let chat = await this.chatModel.findOne({ chatId });

    if (!chat) {
      chat = await this.chatModel.create({
        chatId,
        lastActivity: new Date(),
        messages: [],
        isActive: true,
      });
    }

    return chat;
  }

  async updateLastActivity(chatId: number): Promise<void> {
    await this.chatModel.updateOne(
      { chatId },
      {
        $set: {
          lastActivity: new Date(),
          isActive: true,
        },
      },
    );
  }

  async addMessage(
    chatId: number,
    message: Omit<Message, 'timestamp'>,
  ): Promise<void> {
    await this.chatModel.updateOne(
      { chatId },
      {
        $push: {
          messages: {
            ...message,
            timestamp: new Date(),
          },
        },
        $set: { lastActivity: new Date() },
      },
    );
  }

  async pushMessagesWithMaxHistory(
    chatId: number,
    messages: Omit<Message, 'timestamp'>[],
    maxLength: number = 10,
  ): Promise<void> {
    if (!messages?.length) {
      return;
    }

    let chat = await this.chatModel.findOne({ chatId });

    chat.messages.push(...messages);

    if (chat.messages.length > maxLength) {
      chat.messages.splice(0, chat.messages.length - maxLength);
    }

    await chat.save();
  }

  async getConversationHistory(
    chatId: number,
    timestamps: boolean = false,
  ): Promise<Message[]> {
    const query = this.chatModel.findOne({ chatId });
    if (!timestamps) {
      query.select('-timestamp');
    }
    const chat = await query;

    return chat?.messages || [];
  }

  async clearConversationHistory(chatId: number): Promise<void> {
    await this.chatModel.updateOne({ chatId }, { $set: { messages: [] } });
  }

  async setInactive(chatId: number): Promise<void> {
    await this.chatModel.updateOne({ chatId }, { $set: { isActive: false } });
  }

  async getInactiveChats(minutesThreshold: number): Promise<Chat[]> {
    const thresholdDate = new Date(Date.now() - minutesThreshold * 60 * 1000);

    return await this.chatModel.find({
      lastActivity: { $lt: thresholdDate },
      isActive: true,
    });
  }
}

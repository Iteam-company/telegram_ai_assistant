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
    let chat = await this.findOrCreateChat(chatId);

    chat.lastActivity = new Date();
    chat.isActive = true;

    await chat.save();
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
    const chat = await query.exec();

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

  async getTimezoneOffset(chatId: number): Promise<number> {
    const chat = await this.findOrCreateChat(chatId);

    return chat.userTimeZone;
  }

  async setTimezoneOffset(chatId: number, offset: number): Promise<void> {
    const chat = await this.findOrCreateChat(chatId);
    chat.userTimeZone = offset;
    await chat.save();
  }
}

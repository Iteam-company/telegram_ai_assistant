import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
}

@Schema({ timestamps: true })
export class Chat extends Document {
  @Prop({ required: true, unique: true })
  chatId: number;

  @Prop({ default: Date.now })
  lastActivity: Date;

  @Prop({ default: null })
  userTimeZone: number;

  @Prop({
    type: [
      {
        role: { type: String, enum: ['user', 'assistant', 'system'] },
        content: String,
        timestamp: { type: Date, required: false },
      },
    ],
  })
  messages: Message[];

  @Prop({ default: false })
  isActive: boolean;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);

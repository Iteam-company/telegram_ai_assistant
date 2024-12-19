import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

@Schema({ timestamps: true })
export class Chat extends Document {
  @Prop({ required: true, unique: true })
  chatId: number;

  @Prop({ default: Date.now })
  lastActivity: Date;

  @Prop({ type: [{ role: String, content: String, timestamp: Date }] })
  messages: Message[];

  @Prop({ default: false })
  isActive: boolean;
}

export const ChatSchema = SchemaFactory.createForClass(Chat);
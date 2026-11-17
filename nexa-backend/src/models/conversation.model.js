import mongoose from 'mongoose';

const messageSubSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      default: () => `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    },
    sender: {
      type: String,
      required: true,
      enum: ['user', 'assistant', 'system'],
      default: 'user',
    },
    role: {
      type: String,
      required: true,
      enum: ['user', 'model', 'assistant'],
      default: 'user',
    },
    text: {
      type: String,
      required: true,
      maxlength: 10000,
    },
    model: {
      type: String,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    conversationId: {
      type: String,
      required: [true, 'conversationId is required'],
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: String,
      required: [true, 'userId is required'],
      default: 'shivam',
      index: true,
      trim: true,
    },
    title: {
      type: String,
      default: 'New Conversation',
      trim: true,
      maxlength: 150,
    },
    messages: [messageSubSchema],
    messageCount: {
      type: Number,
      default: 0,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

conversationSchema.index({ userId: 1, lastActivityAt: -1 });

export const Conversation =
  mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
export default Conversation;

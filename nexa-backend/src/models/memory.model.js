import mongoose from 'mongoose';

/**
 * Valid memory categories.
 */
export const MEMORY_CATEGORIES = Object.freeze([
  'preference',
  'project',
  'personal',
  'instruction',
  'fact',
  'other',
]);

const memorySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, 'userId is required'],
      default: 'shivam',
      trim: true,
      index: true,
      maxlength: 100,
    },
    category: {
      type: String,
      required: [true, 'category is required'],
      enum: {
        values: MEMORY_CATEGORIES,
        message: 'Invalid category. Allowed: preference, project, personal, instruction, fact, other',
      },
      default: 'preference',
      index: true,
    },
    key: {
      type: String,
      required: [true, 'key is required'],
      trim: true,
      lowercase: true,
      index: true,
      maxlength: 120,
    },
    value: {
      type: String,
      required: [true, 'value is required'],
      trim: true,
      maxlength: 2000,
    },
    rawInput: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({
        source: 'chat',
        confidence: 1.0,
      }),
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for high-performance retrieval and deduplication
memorySchema.index({ userId: 1, key: 1, isActive: 1 });
memorySchema.index({ userId: 1, category: 1, isActive: 1 });
memorySchema.index({ userId: 1, createdAt: -1 });

// Text index for semantic keyword searching
memorySchema.index({ value: 'text', key: 'text', rawInput: 'text' });

export const Memory = mongoose.models.Memory || mongoose.model('Memory', memorySchema);
export default Memory;

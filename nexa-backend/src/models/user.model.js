import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const refreshTokenSubSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    rotatedAt: {
      type: Date,
      default: null,
    },
    replacedByTokenHash: {
      type: String,
      default: null,
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
      maxlength: 150,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password hash is required'],
      minlength: 6,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: 100,
      default: '',
    },
    aiProvider: {
      type: String,
      enum: {
        values: ['gemini', 'ollama'],
        message: 'aiProvider must be either "gemini" or "ollama"',
      },
      default: 'gemini',
    },
    ollamaModel: {
      type: String,
      trim: true,
      default: 'llama3',
      maxlength: 100,
    },
    geminiFallback: {
      type: Boolean,
      default: true,
    },
    voiceLanguage: {
      type: String,
      trim: true,
      default: 'en-US',
      maxlength: 30,
    },
    refreshTokens: [refreshTokenSubSchema],
  },
  {
    timestamps: true,
  }
);

/**
 * Pre-save middleware to hash passwords if modified.
 * In modern Mongoose, async middleware returns a Promise and must not declare or invoke next().
 */
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * Compares an incoming plain-text password with the stored hash.
 * @param {string} candidatePassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password || !candidatePassword) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Formats user document into safe public/session representation.
 * Removes password and token secrets.
 */
userSchema.methods.toSafeObject = function () {
  return {
    id: this._id.toString(),
    email: this.email,
    displayName: this.displayName || this.email.split('@')[0],
    aiProvider: this.aiProvider,
    ollamaModel: this.ollamaModel,
    geminiFallback: this.geminiFallback,
    voiceLanguage: this.voiceLanguage,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;

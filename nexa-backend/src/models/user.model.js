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
      default: 'ollama',
    },
    ollamaModel: {
      type: String,
      trim: true,
      default: 'llama3.2',
      maxlength: 100,
    },
    ollamaBaseUrl: {
      type: String,
      trim: true,
      default: 'http://127.0.0.1:11434',
      maxlength: 255,
    },
    geminiFallback: {
      type: Boolean,
      default: false,
    },
    voiceLanguage: {
      type: String,
      trim: true,
      default: 'en-US',
      maxlength: 30,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
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
    aiProvider: this.aiProvider || 'ollama',
    ollamaModel: this.ollamaModel || 'llama3.2',
    ollamaBaseUrl: this.ollamaBaseUrl || 'http://127.0.0.1:11434',
    geminiFallback: typeof this.geminiFallback === 'boolean' ? this.geminiFallback : false,
    voiceLanguage: this.voiceLanguage || 'en-US',
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;

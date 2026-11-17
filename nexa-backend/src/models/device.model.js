import mongoose from 'mongoose';

const deviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    deviceId: {
      type: String,
      required: [true, 'Unique device UUID is required'],
      unique: true,
      index: true,
      trim: true,
    },
    deviceName: {
      type: String,
      required: [true, 'Device name is required'],
      trim: true,
      maxlength: 100,
    },
    hashedDeviceToken: {
      type: String,
      default: null,
    },
    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    ollamaAvailable: {
      type: Boolean,
      default: false,
    },
    installedModels: {
      type: [String],
      default: [],
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

deviceSchema.index({ userId: 1, isRevoked: 1 });

export const Device = mongoose.models.Device || mongoose.model('Device', deviceSchema);
export default Device;

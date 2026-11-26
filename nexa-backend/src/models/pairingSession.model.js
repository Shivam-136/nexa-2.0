import mongoose from 'mongoose';

const pairingSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User ID is required'],
      index: true,
    },
    pairingCode: {
      type: String,
      required: [true, 'Pairing code is required'],
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: [true, 'Expiration time is required'],
      index: { expires: 0 }, // MongoDB TTL index to automatically purge expired sessions
    },
    isClaimed: {
      type: Boolean,
      default: false,
      index: true,
    },
    claimedAt: {
      type: Date,
      default: null,
    },
    claimedDeviceId: {
      type: String,
      default: null,
    },
    operationId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'delivering', 'rolling_back', 'failed_rolled_back', 'completed'],
      default: 'pending',
      index: true,
    },
    encryptedCredentialBundle: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    recoveryLease: {
      workerId: { type: String, default: null },
      recoveryEpoch: { type: Number, default: 0 }, // Monotonic integer: never reset to null
      fencedEpoch: { type: Number, default: 0 }, // Monotonic fence written before anchor takeover
      expiresAt: { type: Date, default: null },
      state: { type: String, default: 'idle' },
    },
  },
  {
    timestamps: true,
  }
);

export const PairingSession =
  mongoose.models.PairingSession || mongoose.model('PairingSession', pairingSessionSchema);
export default PairingSession;

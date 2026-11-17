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
  },
  {
    timestamps: true,
  }
);

export const PairingSession =
  mongoose.models.PairingSession || mongoose.model('PairingSession', pairingSessionSchema);
export default PairingSession;

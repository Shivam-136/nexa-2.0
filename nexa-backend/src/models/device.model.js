import mongoose from 'mongoose';

const deviceRefreshTokenSubSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    deviceGeneration: {
      type: Number,
      required: true,
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

const deviceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
      default: null,
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
    deviceGeneration: {
      type: Number,
      required: true,
      default: 1,
      index: true,
    },
    hashedMasterRecoveryCode: {
      type: String,
      default: null,
    },
    fencingTokenSequence: {
      type: Number,
      default: 0,
    },
    hashedDeviceToken: {
      type: String,
      default: null,
    },
    stagedDeviceToken: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    pendingResetAuth: {
      ratId: { type: String, default: null },
      deviceGeneration: { type: Number, default: null },
      intendedNewUserId: { type: String, default: null },
      clientRecoveryPubKey: { type: Buffer, default: null },
      clientRecoveryPubKeyFingerprint: { type: String, default: null },
      // DURABLE IDEMPOTENCY FIELDS
      persistedSignedRat: { type: String, default: null },
      persistedRatHash: { type: String, default: null },
      consumedNonces: { type: [String], default: [] },
      lastRetryTimestamp: { type: Number, default: 0 },
      lastRetryAt: { type: Date, default: null },
      retryCounter: { type: Number, default: 0 },
      expiresAt: { type: Date, default: null },
      isConsumed: { type: Boolean, default: false },
    },
    activePairingLock: {
      state: {
        type: String,
        enum: ['idle', 'in_pairing', 'revocation_committed'],
        default: 'idle',
      },
      operationId: { type: String, default: null },
      recoveryWorkerId: { type: String, default: null },
      recoveryEpoch: { type: Number, default: 0 }, // Monotonic integer: never reset to null
      recoveryLeaseExpiresAt: { type: Date, default: null },
      milestoneState: {
        type: String,
        enum: ['idle', 'milestone_a_done', 'milestone_b_in_progress'],
        default: 'idle',
      },
      lastAnchorVerificationAt: { type: Date, default: null },
      deliveryFence: {
        clientRetrievalId: { type: String, default: null },
        clientSessionPubKey: { type: Buffer, default: null },
        fencingToken: { type: Number, default: 0 }, // Monotonic integer: never reset to null
        expiresAt: { type: Date, default: null },
      },
    },
    lastConfirmedActivationAt: {
      type: Date,
      default: null,
    },
    lastConfirmedActivation: {
      operationId: { type: String, default: null },
      clientRetrievalId: { type: String, default: null },
      fencingToken: { type: Number, default: null },
      clientSessionPubKey: { type: Buffer, default: null },
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
    unpairedAt: {
      type: Date,
      default: null,
    },
    unpairedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isQuarantined: {
      type: Boolean,
      default: false,
      index: true,
    },
    quarantineReason: {
      type: String,
      default: null,
    },
    deviceTokenExpiresAt: {
      type: Date,
      default: null,
    },
    lastAuthenticatedAt: {
      type: Date,
      default: null,
    },
    deviceRefreshTokens: {
      type: [deviceRefreshTokenSubSchema],
      default: [],
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
    lastHeartbeatAt: {
      type: Date,
      default: null,
    },
    heartbeatCount: {
      type: Number,
      default: 0,
    },
    heartbeatMetadata: {
      agentVersion: { type: String, default: null },
      platform: { type: String, default: null },
      arch: { type: String, default: null },
      uptimeSeconds: { type: Number, default: null },
    },
  },
  {
    timestamps: true,
  }
);

deviceSchema.index({ userId: 1, isRevoked: 1 });

export const Device = mongoose.models.Device || mongoose.model('Device', deviceSchema);
export default Device;

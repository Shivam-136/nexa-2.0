import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import User from '../src/models/user.model.js';
import Memory from '../src/models/memory.model.js';
import Conversation from '../src/models/conversation.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runMigration() {
  const targetIdentifier = process.argv[2];

  console.log('========================================================');
  console.log('🚀 NEXA 2.0 — Phase 6: Legacy Data Safe Migration Utility');
  console.log('========================================================');

  if (!targetIdentifier) {
    console.error('❌ Error: Target user email or MongoDB user ID is required.');
    console.log('Usage: node scripts/migrate-legacy.js <user-email-or-id>');
    process.exit(1);
  }

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexa';
  console.log(`Connecting to MongoDB...`);
  await mongoose.connect(mongoUri);

  try {
    // 1. Locate destination user
    let user = null;
    if (mongoose.Types.ObjectId.isValid(targetIdentifier)) {
      user = await User.findById(targetIdentifier);
    }
    if (!user) {
      user = await User.findOne({ email: targetIdentifier.toLowerCase().trim() });
    }

    if (!user) {
      console.error(`❌ User not found with identifier "${targetIdentifier}".`);
      process.exit(1);
    }

    const newUserId = user._id.toString();
    console.log(`✓ Destination user identified: ${user.email} (ID: ${newUserId})`);

    // 2. Count legacy records
    const legacyMemories = await Memory.countDocuments({ userId: 'shivam' });
    const legacyConversations = await Conversation.countDocuments({ userId: 'shivam' });

    console.log(`\nFound legacy records with userId = "shivam":`);
    console.log(`  - Memories: ${legacyMemories}`);
    console.log(`  - Conversations: ${legacyConversations}`);

    if (legacyMemories === 0 && legacyConversations === 0) {
      console.log('\n✨ No unclaimed legacy records found. Everything is already migrated.');
      return;
    }

    // 3. Migrate records safely without deletion
    console.log(`\nMigrating legacy records to ${user.email}...`);
    const memResult = await Memory.updateMany(
      { userId: 'shivam' },
      { $set: { userId: newUserId } }
    );
    const convResult = await Conversation.updateMany(
      { userId: 'shivam' },
      { $set: { userId: newUserId } }
    );

    console.log(`\n✅ Migration completed successfully!`);
    console.log(`  - Migrated memories: ${memResult.modifiedCount}`);
    console.log(`  - Migrated conversations: ${convResult.modifiedCount}`);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

runMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});

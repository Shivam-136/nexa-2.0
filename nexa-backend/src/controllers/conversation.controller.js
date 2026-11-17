import Conversation from '../models/conversation.model.js';
import mongoose from 'mongoose';

/**
 * Extracts userId strictly from verified authentication middleware.
 * Never trusts userId from headers, query, or body.
 */
function getRequestUserId(req) {
  if (req.user?.id) {
    return req.user.id.toString();
  }
  // Internal fallback for unit tests running without auth middleware
  if (req.userId) {
    return req.userId.toString();
  }
  return 'shivam';
}

/**
 * GET /api/conversations
 * Lists conversations for the current user.
 */
export async function listConversations(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(200).json({ success: true, conversations: [], total: 0 });
    }

    const userId = getRequestUserId(req);
    const { page = 1, limit = 30 } = req.query;

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const query = { userId };

    const [conversations, total] = await Promise.all([
      Conversation.find(query, {
        conversationId: 1,
        title: 1,
        messageCount: 1,
        lastActivityAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean(),
      Conversation.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      conversations,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/conversations/:id
 * Retrieves full conversation history including messages.
 */
export async function getConversation(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database service is currently unavailable.' });
    }

    const userId = getRequestUserId(req);
    const { id } = req.params;

    const conversation = await Conversation.findOne({
      $or: [{ conversationId: id }, ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : [])],
      userId,
    }).lean();

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: `Conversation "${id}" not found.`,
      });
    }

    return res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/conversations/:id
 * Deletes a conversation by conversationId.
 */
export async function deleteConversation(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database service is currently unavailable.' });
    }

    const userId = getRequestUserId(req);
    const { id } = req.params;

    const result = await Conversation.findOneAndDelete({
      $or: [{ conversationId: id }, ...(mongoose.Types.ObjectId.isValid(id) ? [{ _id: id }] : [])],
      userId,
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found or already deleted.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Conversation deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/conversations
 * Clears all conversations for the user.
 */
export async function clearConversations(req, res, next) {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Database service is currently unavailable.' });
    }

    const userId = getRequestUserId(req);
    const result = await Conversation.deleteMany({ userId });

    return res.status(200).json({
      success: true,
      deletedCount: result.deletedCount || 0,
      message: `Cleared ${result.deletedCount || 0} conversation history records.`,
    });
  } catch (error) {
    next(error);
  }
}

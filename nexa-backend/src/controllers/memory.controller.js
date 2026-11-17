import {
  listMemories,
  saveMemory,
  deleteMemoryById,
  clearAllUserMemories,
  categorizeMemory,
} from '../services/memory.service.js';
import Memory, { MEMORY_CATEGORIES } from '../models/memory.model.js';
import mongoose from 'mongoose';

/**
 * Helper to extract userId from request headers or query.
 */
function getRequestUserId(req) {
  const headerUser = req.headers['x-user-id'];
  const queryUser = req.query?.userId;
  const bodyUser = req.body?.userId;
  return (headerUser || queryUser || bodyUser || 'shivam').trim();
}

/**
 * GET /api/memories
 * Lists memories for the current user.
 */
export async function getMemories(req, res, next) {
  try {
    const userId = getRequestUserId(req);
    const { category, search, page = 1, limit = 50 } = req.query;

    const data = await listMemories({
      userId,
      category,
      search,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
    });

    return res.status(200).json({
      success: true,
      ...data,
      categories: MEMORY_CATEGORIES,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/memories
 * Manually adds or updates a memory.
 */
export async function createMemory(req, res, next) {
  try {
    const userId = getRequestUserId(req);
    const { key, value, category, rawInput, metadata } = req.body || {};

    if (!value || typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Field "value" is required and must be a non-empty string.',
      });
    }

    if (category && !MEMORY_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        error: `Invalid category. Allowed: ${MEMORY_CATEGORIES.join(', ')}`,
      });
    }

    const result = await saveMemory({
      userId,
      category,
      key,
      value: value.trim(),
      rawInput: rawInput || value.trim(),
      metadata: { ...metadata, source: 'manual' },
    });

    return res.status(result.isNew ? 201 : 200).json({
      success: true,
      memory: result.memory,
      isNew: result.isNew,
      message: result.isNew ? 'Memory created successfully' : 'Existing memory updated (deduplicated)',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/memories/:id
 * Updates an existing memory.
 */
export async function updateMemory(req, res, next) {
  try {
    const userId = getRequestUserId(req);
    const { id } = req.params;
    const { value, category, key } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid memory ID format.',
      });
    }

    const memory = await Memory.findOne({ _id: id, userId });
    if (!memory) {
      return res.status(404).json({
        success: false,
        error: 'Memory not found.',
      });
    }

    if (value && typeof value === 'string') {
      memory.value = value.trim();
    }
    if (category && MEMORY_CATEGORIES.includes(category)) {
      memory.category = category;
    }
    if (key && typeof key === 'string') {
      memory.key = key.trim().toLowerCase();
    }

    await memory.save();

    return res.status(200).json({
      success: true,
      memory: memory.toObject(),
      message: 'Memory updated successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/memories/:id
 * Deletes a memory by ID.
 */
export async function deleteMemory(req, res, next) {
  try {
    const userId = getRequestUserId(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid memory ID format.',
      });
    }

    const deleted = await deleteMemoryById(id, userId);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Memory not found or already deleted.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Memory deleted successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/memories
 * Clears all memories for the current user.
 */
export async function clearMemories(req, res, next) {
  try {
    const userId = getRequestUserId(req);
    const count = await clearAllUserMemories(userId);

    return res.status(200).json({
      success: true,
      deletedCount: count,
      message: `Cleared ${count} memories for user ${userId}.`,
    });
  } catch (error) {
    next(error);
  }
}

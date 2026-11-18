import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Trash2,
  Plus,
  RefreshCw,
  Search,
  Tag,
  AlertTriangle,
  Clock,
  Sparkles,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { fetchMemories, createMemory, deleteMemory, clearAllMemories } from '../../services/memory.service';
import { MEMORY_CATEGORIES } from '../../utils/constants';

const CATEGORY_COLORS = {
  preference: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  project: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  personal: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  instruction: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  fact: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  other: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
};

export default function MemoryManagement({ addToast }) {
  const [memories, setMemories] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  // Add memory modal/form state
  const [isAdding, setIsAdding] = useState(false);
  const [newMemoryValue, setNewMemoryValue] = useState('');
  const [newMemoryCategory, setNewMemoryCategory] = useState('preference');
  const [newMemoryKey, setNewMemoryKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Deleting item ID tracker
  const [deletingId, setDeletingId] = useState(null);

  const loadMemories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemories({
        category: selectedCategory === 'All' ? undefined : selectedCategory,
        search: searchTerm,
      });
      setMemories(data.memories || []);
      setTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load memories:', err);
      setError(err.message || 'Unable to connect to MongoDB memory service.');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchTerm]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadMemories();
    }, 200);
    return () => clearTimeout(timer);
  }, [loadMemories]);

  const handleDelete = async (id, value) => {
    if (!id) return;
    setDeletingId(id);
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m._id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      addToast?.('Memory Deleted', `Removed: "${value.length > 32 ? value.substring(0, 32) + '...' : value}"`, 'info');
    } catch (err) {
      addToast?.('Delete Failed', err.message || 'Failed to delete memory.', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to delete all saved long-term memories?')) {
      return;
    }
    try {
      await clearAllMemories();
      setMemories([]);
      setTotal(0);
      addToast?.('Memories Cleared', 'All persistent memories have been deleted.', 'info');
    } catch (err) {
      addToast?.('Clear Failed', err.message, 'error');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newMemoryValue.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await createMemory({
        value: newMemoryValue.trim(),
        category: newMemoryCategory,
        key: newMemoryKey.trim() || undefined,
      });

      addToast?.('Memory Saved', res.message || 'Saved to persistent storage.', 'success');
      setNewMemoryValue('');
      setNewMemoryKey('');
      setIsAdding(false);
      loadMemories();
    } catch (err) {
      addToast?.('Save Failed', err.message || 'Failed to save memory.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 rounded-3xl glass-card space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-800/80 pb-4 gap-3">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center space-x-2">
              <span>Persistent Memory System</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {total} {total === 1 ? 'Record' : 'Records'}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Long-term preferences and facts remembered by NEXA across sessions via MongoDB.
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsAdding(!isAdding)}
            className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-md shadow-purple-600/20 transition-all flex items-center space-x-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Memory</span>
          </button>

          <button
            type="button"
            onClick={loadMemories}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
            title="Refresh saved memories from MongoDB"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {memories.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-xs transition-colors"
              title="Clear all stored memories"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Manual Memory Creation Form Modal/Card */}
      {isAdding && (
        <form
          onSubmit={handleCreate}
          className="p-4 rounded-2xl bg-slate-900/90 border border-purple-500/30 space-y-3 text-xs"
        >
          <div className="flex items-center justify-between font-semibold text-slate-200">
            <span className="flex items-center space-x-1.5">
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>Record New Memory</span>
            </span>
            <span className="text-[11px] text-slate-400">Will be injected into AI reasoning</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">Memory Content / Preference *</label>
              <input
                type="text"
                required
                value={newMemoryValue}
                onChange={(e) => setNewMemoryValue(e.target.value)}
                placeholder="e.g. User prefers Hindi for speech and chat"
                className="w-full px-3 py-2 rounded-xl glass-input text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Category</label>
              <select
                value={newMemoryCategory}
                onChange={(e) => setNewMemoryCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl glass-input text-slate-200 capitalize bg-slate-900 focus:outline-none focus:border-purple-500"
              >
                {MEMORY_CATEGORIES.filter((c) => c !== 'All').map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <input
              type="text"
              value={newMemoryKey}
              onChange={(e) => setNewMemoryKey(e.target.value)}
              placeholder="Optional unique key (e.g. preferred_language)"
              className="max-w-xs px-3 py-1.5 rounded-lg glass-input text-[11px] text-slate-300 placeholder-slate-500 focus:outline-none"
            />

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !newMemoryValue.trim()}
                className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save Memory'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Search and Category Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1 max-w-sm">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search saved memories..."
            className="w-full pl-8 pr-3 py-1.5 rounded-xl glass-input text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500/60"
          />
        </div>

        {/* Category Pills */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0">
          {MEMORY_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-2.5 py-1 rounded-lg font-medium text-[11px] capitalize transition-colors whitespace-nowrap ${
                selectedCategory === cat
                  ? 'bg-purple-600 text-white font-semibold'
                  : 'bg-slate-900/60 text-slate-400 hover:text-white border border-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main Memory List Display */}
      {loading ? (
        <div className="py-12 text-center text-slate-400 flex flex-col items-center justify-center space-y-2">
          <RefreshCw className="h-6 w-6 text-purple-400 animate-spin" />
          <p className="text-xs">Loading persistent memories from MongoDB...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs flex items-start justify-between">
          <div className="flex items-start space-x-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-200">Database Connection Notice</p>
              <p className="text-amber-300/80 text-[11px] mt-0.5 leading-relaxed">{error}</p>
            </div>
          </div>
          <button
            onClick={loadMemories}
            className="px-3 py-1 rounded-lg bg-amber-900/40 hover:bg-amber-800/60 text-amber-200 text-xs transition-colors"
          >
            Retry
          </button>
        </div>
      ) : memories.length === 0 ? (
        <div className="py-12 px-4 rounded-2xl bg-slate-950/40 border border-slate-800/80 text-center space-y-2">
          <Brain className="h-8 w-8 mx-auto text-slate-600 opacity-60" />
          <p className="text-sm font-medium text-slate-300">No persistent memories stored yet</p>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            NEXA will automatically save preferences when you speak or type commands like:
            <br />
            <code className="text-purple-300 font-mono text-[11px]">"Remember that I prefer Hindi."</code> or{' '}
            <code className="text-cyan-300 font-mono text-[11px]">"Remember my project details."</code>
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 max-h-96 overflow-y-auto pr-1">
          {memories.map((mem) => {
            const badgeColor =
              CATEGORY_COLORS[mem.category] || CATEGORY_COLORS.other;
            const isDeleting = deletingId === mem._id;
            const dateStr = mem.updatedAt
              ? new Date(mem.updatedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Recently';

            return (
              <div
                key={mem._id}
                className="p-3.5 rounded-2xl bg-slate-950/60 hover:bg-slate-900/70 border border-slate-800/80 hover:border-purple-500/30 transition-all flex items-start justify-between gap-3 text-xs"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono border capitalize font-semibold ${badgeColor}`}
                    >
                      {mem.category}
                    </span>

                    {mem.key && (
                      <span className="font-mono text-[10px] text-slate-400 flex items-center space-x-1">
                        <Tag className="h-2.5 w-2.5 text-slate-500" />
                        <span>{mem.key}</span>
                      </span>
                    )}

                    <span className="text-[10px] text-slate-500 flex items-center space-x-1">
                      <Clock className="h-2.5 w-2.5" />
                      <span>{dateStr}</span>
                    </span>
                  </div>

                  <p className="text-slate-200 font-medium text-xs leading-relaxed break-words">
                    {mem.value}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleDelete(mem._id, mem.value)}
                  disabled={isDeleting}
                  className="p-1.5 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors flex-shrink-0"
                  title="Forget this memory"
                >
                  <Trash2 className={`h-4 w-4 ${isDeleting ? 'animate-pulse text-rose-400' : ''}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

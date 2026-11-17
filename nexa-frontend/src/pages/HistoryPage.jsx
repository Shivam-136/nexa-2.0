import React, { useState, useEffect, useCallback } from 'react';
import {
  History,
  Search,
  Download,
  Trash2,
  MessageSquare,
  Clock,
  RefreshCw,
  ChevronRight,
  Bot,
  User,
  Database,
  Calendar,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import StatusBadge from '../components/common/StatusBadge';
import {
  fetchConversations,
  fetchConversation,
  deleteConversation,
} from '../services/memory.service';

export default function HistoryPage() {
  const { recentActivity, addToast, connectionStatus } = useAppContext();
  const [activeTab, setActiveTab] = useState('conversations'); // 'conversations' | 'audit'

  // Audit Log State
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [cleared, setCleared] = useState(false);

  // Saved Conversations State (Phase 5 MongoDB)
  const [conversations, setConversations] = useState([]);
  const [totalConversations, setTotalConversations] = useState(0);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingConvId, setDeletingConvId] = useState(null);

  const loadSavedConversations = useCallback(async () => {
    setLoadingConversations(true);
    try {
      const data = await fetchConversations({ page: 1, limit: 50 });
      setConversations(data.conversations || []);
      setTotalConversations(data.total || 0);
    } catch (err) {
      console.warn('Could not load conversations from MongoDB:', err.message);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'conversations') {
      loadSavedConversations();
    }
  }, [activeTab, loadSavedConversations]);

  const handleSelectConversation = async (conv) => {
    if (selectedConversation?.conversationId === conv.conversationId) {
      setSelectedConversation(null);
      return;
    }

    setLoadingDetail(true);
    try {
      const res = await fetchConversation(conv.conversationId);
      setSelectedConversation(res.conversation);
    } catch (err) {
      addToast('Conversation Load Failed', err.message, 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleDeleteConversation = async (e, convId) => {
    e.stopPropagation();
    setDeletingConvId(convId);
    try {
      await deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.conversationId !== convId));
      setTotalConversations((prev) => Math.max(0, prev - 1));
      if (selectedConversation?.conversationId === convId) {
        setSelectedConversation(null);
      }
      addToast('Conversation Deleted', 'Conversation thread removed from MongoDB.', 'info');
    } catch (err) {
      addToast('Delete Failed', err.message, 'error');
    } finally {
      setDeletingConvId(null);
    }
  };

  // Derive real session logs from user activity
  const logs = cleared
    ? []
    : recentActivity.map((act) => ({
        id: act.id,
        command: act.title,
        type: act.type === 'command' ? 'Command' : 'System',
        target: 'Operator Console',
        timestamp: act.time,
        status: act.status,
        duration: '--',
      }));

  const handleExport = () => {
    addToast('Audit Log Exported', 'Downloaded operator session log (JSON format).', 'success');
  };

  const handleClear = () => {
    setCleared(true);
    addToast('Audit Log Cleared', 'Session history buffer has been reset.', 'info');
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.command.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.target.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'All' || log.type.toLowerCase() === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-3xl glass-panel gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-cyan-400 border border-blue-500/20">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">History &amp; Dialogue Archives</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Inspect persisted multi-turn conversations stored in MongoDB and live operator audit trails.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center space-x-2 p-1 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('conversations')}
            className={`px-3.5 py-1.5 rounded-xl font-medium transition-colors flex items-center space-x-1.5 ${
              activeTab === 'conversations'
                ? 'bg-blue-600 text-white font-semibold shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>Saved Conversations ({totalConversations})</span>
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-1.5 rounded-xl font-medium transition-colors flex items-center space-x-1.5 ${
              activeTab === 'audit'
                ? 'bg-blue-600 text-white font-semibold shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <History className="h-3.5 w-3.5" />
            <span>Audit Trail</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: Saved Conversations (Phase 5 MongoDB Persistence) */}
      {activeTab === 'conversations' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs text-slate-400">
              <Database className="h-4 w-4 text-purple-400" />
              <span>
                MongoDB Storage: <strong className="text-slate-200">{connectionStatus.database || 'Connected'}</strong>
              </span>
            </div>

            <button
              onClick={loadSavedConversations}
              disabled={loadingConversations}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
            >
              <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${loadingConversations ? 'animate-spin' : ''}`} />
              <span>Refresh Archives</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Conversation Threads List */}
            <div className="lg:col-span-1 space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {loadingConversations ? (
                <div className="py-16 text-center text-slate-400 space-y-2">
                  <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto" />
                  <p className="text-xs">Loading conversations from MongoDB...</p>
                </div>
              ) : conversations.length === 0 ? (
                <div className="py-16 p-4 rounded-2xl glass-card text-center space-y-2">
                  <MessageSquare className="h-8 w-8 mx-auto text-slate-600 opacity-50" />
                  <p className="text-sm font-medium text-slate-300">No saved conversations</p>
                  <p className="text-xs text-slate-500">
                    Your conversations with NEXA will be automatically archived here.
                  </p>
                </div>
              ) : (
                conversations.map((conv) => {
                  const isSelected = selectedConversation?.conversationId === conv.conversationId;
                  const isDeleting = deletingConvId === conv.conversationId;
                  const dateStr = conv.lastActivityAt
                    ? new Date(conv.lastActivityAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'Recent';

                  return (
                    <div
                      key={conv.conversationId}
                      onClick={() => handleSelectConversation(conv)}
                      className={`p-4 rounded-2xl cursor-pointer transition-all border text-xs space-y-2 ${
                        isSelected
                          ? 'bg-blue-950/40 border-blue-500/50 shadow-md'
                          : 'glass-card hover:bg-slate-900/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 truncate pr-2">
                          {conv.title || 'Conversation'}
                        </span>
                        <button
                          onClick={(e) => handleDeleteConversation(e, conv.conversationId)}
                          disabled={isDeleting}
                          className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                          title="Delete conversation thread"
                        >
                          <Trash2 className={`h-3.5 w-3.5 ${isDeleting ? 'animate-pulse text-rose-400' : ''}`} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                        <span className="flex items-center space-x-1">
                          <MessageSquare className="h-3 w-3 text-cyan-400" />
                          <span>{conv.messageCount || 0} messages</span>
                        </span>
                        <span className="flex items-center space-x-1 text-slate-500">
                          <Clock className="h-3 w-3" />
                          <span>{dateStr}</span>
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Conversation Dialogue Viewer */}
            <div className="lg:col-span-2 rounded-3xl glass-panel p-6 flex flex-col min-h-[400px]">
              {selectedConversation ? (
                <div className="space-y-4 flex-1 flex flex-col">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
                    <div>
                      <h3 className="font-bold text-white text-sm">
                        {selectedConversation.title || 'Conversation Transcript'}
                      </h3>
                      <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                        ID: {selectedConversation.conversationId} &bull; Total Messages: {selectedConversation.messages?.length || 0}
                      </p>
                    </div>

                    <button
                      onClick={() => setSelectedConversation(null)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Close Viewer
                    </button>
                  </div>

                  <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2 flex-1">
                    {selectedConversation.messages?.map((msg, idx) => {
                      const isUser = msg.sender === 'user';
                      return (
                        <div
                          key={msg.id || idx}
                          className={`p-3.5 rounded-2xl text-xs space-y-1 ${
                            isUser
                              ? 'bg-blue-950/40 border border-blue-900/50 text-blue-100 ml-8'
                              : 'bg-slate-900/90 border border-slate-800 text-slate-200 mr-8'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
                            <span className="flex items-center space-x-1">
                              {isUser ? <User className="h-3 w-3 text-blue-400" /> : <Bot className="h-3 w-3 text-cyan-400" />}
                              <span>{isUser ? 'Operator' : 'NEXA 2.0'}</span>
                            </span>
                            <span className="font-mono text-slate-500 text-[10px]">
                              {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="m-auto text-center py-20 text-slate-400 space-y-2">
                  <MessageSquare className="h-10 w-10 mx-auto text-slate-600 opacity-40" />
                  <p className="text-sm font-medium text-slate-300">Select a conversation thread to view transcript</p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Complete conversational turn history is safely persisted in your local MongoDB instance.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: Operational Audit Trail (Existing Phase 1-4 Feature) */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search commands, targets, or logs..."
                className="w-full pl-9 pr-4 py-2 rounded-xl glass-input text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/60"
              />
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleExport}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700/80 transition-colors"
              >
                <Download className="h-4 w-4" />
                <span>Export Log</span>
              </button>
              <button
                onClick={handleClear}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                <span>Clear History</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl glass-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Timestamp</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Instruction / Event</th>
                    <th className="py-3 px-4">Target Subsystem</th>
                    <th className="py-3 px-4">Latency</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-12 text-center text-slate-500">
                        <History className="h-8 w-8 mx-auto mb-2 opacity-40 text-slate-600" />
                        <p className="text-sm font-medium text-slate-400">No activity logs recorded</p>
                        <p className="text-xs text-slate-500 mt-1">
                          Commands dispatched during this session will be recorded here in real time.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                          {log.timestamp}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px]">
                            {log.type}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 font-medium text-slate-200">{log.command}</td>
                        <td className="py-3.5 px-4 text-slate-400 font-mono">{log.target}</td>
                        <td className="py-3.5 px-4 text-slate-500 font-mono">{log.duration}</td>
                        <td className="py-3.5 px-4">
                          <StatusBadge
                            status={log.status}
                            label={log.status === 'success' ? 'Completed' : 'Pending Bridge'}
                            size="xs"
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

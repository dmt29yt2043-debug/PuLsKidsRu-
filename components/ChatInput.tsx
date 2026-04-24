'use client';

import { useState, useRef, useCallback } from 'react';
import type { ChatMessage, FilterState, Event } from '@/lib/types';
import ChatMessages from './ChatMessages';

interface ChatInputProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  onEventClick: (event: Event) => void;
}

export default function ChatInput({ filters, onFiltersChange, onEventClick }: ChatInputProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setExpanded(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          filters,
          history: newMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) throw new Error('Chat request failed');

      const data = await res.json();
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.message || 'I found some events for you.',
        events: data.events,
        filters: data.filters,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // Apply filters from AI if present
      if (data.filters && Object.keys(data.filters).length > 0) {
        onFiltersChange(data.filters);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, filters, onFiltersChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-lg">
      {/* Messages area */}
      {expanded && messages.length > 0 && (
        <div className="border-b border-gray-100">
          <div className="flex items-center justify-between px-4 py-1.5">
            <span className="text-xs text-gray-400">Chat</span>
            <button
              onClick={() => setExpanded(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              minimize
            </button>
          </div>
          <ChatMessages messages={messages} onEventClick={onEventClick} />
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 px-4 py-3">
        {messages.length > 0 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-xs"
          >
            {messages.length}
          </button>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe what you're looking for..."
          rows={1}
          className="flex-1 resize-none px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-[#e91e63] max-h-24"
          style={{ minHeight: 38 }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || loading}
          className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-white disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: '#e91e63' }}
        >
          {loading ? (
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <span className="text-lg leading-none">&uarr;</span>
          )}
        </button>
      </div>
    </div>
  );
}

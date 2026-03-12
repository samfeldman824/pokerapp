import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChatMessage } from '@/lib/useGameSocket'

const REACTIONS = ['Nice hand!', 'GG', 'Well played', 'LOL', 'Unlucky'] as const

type ChatPanelProps = {
  messages: ChatMessage[]
  onSendMessage: (text: string, type: 'custom' | 'reaction') => void
  isOpen: boolean
  onToggle: () => void
  unreadCount: number
  currentUserId?: string | null
}

export function ChatPanel({
  messages,
  onSendMessage,
  isOpen,
  onToggle,
  unreadCount,
  currentUserId,
}: ChatPanelProps) {
  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  const handleSend = () => {
    const trimmed = inputText.trim()
    if (trimmed) {
      onSendMessage(trimmed, 'custom')
      setInputText('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 z-50 flex items-center justify-center rounded-full bg-indigo-600 p-4 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-950"
        aria-label="Open chat"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-rose-500 text-xs font-bold text-white shadow-sm ring-2 ring-gray-950">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[500px] w-80 flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl transition-all sm:w-96">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 bg-gray-950 px-4 py-3">
        <h3 className="font-semibold text-gray-200">Table Chat</h3>
        <button
          onClick={onToggle}
          className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 ">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No messages yet. Say hi!
          </div>
        ) : (
          messages.map((msg, i) => {
            const isReaction = msg.type === 'reaction'
            const isMe = msg.senderId === currentUserId
            const alignClass = isMe ? 'items-end' : 'items-start'
            const nameColor = isMe ? 'text-emerald-400' : 'text-indigo-400'
            const bgClass = isReaction
              ? (isMe ? 'bg-emerald-900/40 border border-emerald-500/30 text-emerald-100' : 'bg-indigo-900/40 border border-indigo-500/30 text-indigo-100')
              : (isMe ? 'bg-emerald-800 text-white' : 'bg-gray-800 text-gray-200')
            return (
              <div key={msg.id || i} className={`group flex flex-col ${alignClass} `}>
                <span className={`text-xs font-bold ${nameColor} mb-0.5 ${isMe ? 'mr-1' : 'ml-1'}`}>{msg.senderName}</span>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${bgClass}`}>
                  {msg.text}
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Reactions */}
      <div className="border-t border-gray-800 bg-gray-900/50 p-2">
        <div className="flex flex-wrap gap-2">
          {REACTIONS.map((reaction) => (
            <button
              key={reaction}
              onClick={() => onSendMessage(reaction, 'reaction')}
              className="rounded-full border border-gray-700 bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-indigo-500/50 hover:bg-indigo-900/30 hover:text-indigo-200"
            >
              {reaction}
            </button>
          ))}
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-gray-950 p-3">
        <div className="relative flex items-center">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="w-full resize-none rounded-xl border border-gray-700 bg-gray-800 py-2.5 pl-3 pr-10 text-sm text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            rows={1}
            maxLength={200}
          />
          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="absolute right-2 rounded-full p-1.5 text-indigo-400 transition-colors hover:bg-indigo-500/10 hover:text-indigo-300 disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

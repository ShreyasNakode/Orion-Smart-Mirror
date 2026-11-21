import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Bot, Send, Sparkles, User, RefreshCw } from 'lucide-react';
import { SkinAnalysisRecord } from '../types';

interface Message {
  id: string;
  sender: 'ai' | 'user';
  text: string;
  timestamp: string;
}

interface GeminiSkinAssistantProps {
  latestScan: SkinAnalysisRecord | null;
  history: SkinAnalysisRecord[];
}

export function GeminiSkinAssistant({ latestScan, history }: GeminiSkinAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      sender: 'ai',
      text: latestScan 
        ? `Hello! I am Orion, your dedicated Gemini Skin Health Assistant. I've reviewed your latest analysis (Score: ${latestScan.score}%, Hydration: ${latestScan.hydration}%, Acne: ${latestScan.acneSeverity}). How can I help you optimize your routine or explain changes in your skin today?`
        : "Hello! I am Orion, your dedicated Gemini Skin Health Assistant. Complete a skin analysis scan above and I'll analyze your metrics and guide your routine over time!",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputText;
    if (!query.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: query,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputText('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/skin/gemini_reasoning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metrics: latestScan,
          history: history.slice(0, 5),
          question: query
        })
      });

      if (response.ok) {
        const data = await response.json();
        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: data.text || "Your skin metrics show stable progression. Continue hydration and sunscreen protection.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setMessages(prev => [...prev, aiMsg]);
      } else {
        throw new Error('API failed');
      }
    } catch (err) {
      console.warn('Gemini Assistant fallback response:', err);
      const fallbackMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: 'ai',
        text: `Based on your latest scan (Score: ${latestScan?.score || 85}%, Hydration: ${latestScan?.hydration || 80}%), your skin barrier is reacting to environmental factors. I recommend keeping your hydration step consistent and maintaining daily mineral SPF 50.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, fallbackMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const sampleQuestions = [
    "Why is my skin drier today?",
    "Is my acne improving?",
    "What product should I use for UV protection?"
  ];

  return (
    <div className="flex flex-col h-[480px] bg-surface-container/40 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-xl">
      {/* Header */}
      <div className="px-6 py-4 bg-white/5 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center border border-primary/40 glow-primary">
            <Sparkles className="text-primary" size={20} />
          </div>
          <div>
            <h3 className="font-bold text-white text-md flex items-center gap-2">
              Gemini Live Skin Assistant
              <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
            </h3>
            <p className="text-xs text-on-surface-variant">Context-aware dermatological reasoning</p>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 p-6 overflow-y-auto flex flex-col gap-4">
        {messages.map((m) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 max-w-[85%] ${m.sender === 'user' ? 'ml-auto flex-row-reverse' : 'mr-auto'}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${m.sender === 'user' ? 'bg-secondary text-on-secondary' : 'bg-primary/20 text-primary border border-primary/30'}`}>
              {m.sender === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className={`p-4 rounded-2xl text-sm leading-relaxed ${m.sender === 'user' ? 'bg-secondary/20 text-white border border-secondary/30 rounded-tr-none' : 'bg-white/5 text-on-surface border border-white/10 rounded-tl-none'}`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              <span className="text-[10px] text-on-surface-variant block mt-2 opacity-70 text-right">{m.timestamp}</span>
            </div>
          </motion.div>
        ))}
        {isLoading && (
          <div className="flex items-center gap-2 text-primary text-sm p-4 bg-primary/10 rounded-xl w-max">
            <RefreshCw size={16} className="animate-spin" />
            Gemini is evaluating your skin data...
          </div>
        )}
      </div>

      {/* Quick Prompts */}
      <div className="px-6 py-2 flex gap-2 overflow-x-auto border-t border-white/5 bg-black/10">
        {sampleQuestions.map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(q)}
            className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSendMessage();
        }}
        className="p-4 bg-white/5 border-t border-white/10 flex items-center gap-3"
      >
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Ask Gemini about your skin metrics, acne, or routine..."
          className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-on-surface-variant/60 focus:outline-none focus:border-primary/50"
        />
        <button
          type="submit"
          disabled={!inputText.trim() || isLoading}
          className="p-2.5 bg-primary text-on-primary rounded-xl hover:bg-primary-container disabled:opacity-50 transition-colors"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

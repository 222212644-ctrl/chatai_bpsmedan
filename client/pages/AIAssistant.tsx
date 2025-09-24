import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, ExternalLink, Loader2, MessageSquare, Edit, Square } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { bpsData, searchBPSData, getSuggestions, getCategories, detectSpecificKeywords, BPSDataItem } from "@/data/bpsData";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarProvider,
  SidebarInset,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";

interface Message {
  id: string;
  content: string;
  type: "user" | "assistant";
  timestamp: Date;
  sources?: Array<{
    title: string;
    url: string;
  }>;
  relatedData?: BPSDataItem[];
}

interface ConversationContext {
  previousTopics: string[];
  userPreferences: string[];
  conversationCount: number;
}

// Logic functions moved to a separate file (optional but recommended)
const detectQuestionType = (question: string): string => {
  const lower = question.toLowerCase();
  if (lower.includes('halo') || lower.includes('hai') || lower.includes('hello')) return 'greeting';
  if (lower.includes('terima kasih') || lower.includes('thanks')) return 'thanks';
  if (lower.includes('siapa') || lower.includes('who') || lower.includes('kamu siapa') || lower.includes('anda siapa')) return 'identity';
  if (lower.includes('list') || lower.includes('daftar') || lower.includes('kategori')) return 'list';
  return 'information';
};

const findRelevantData = (question: string): BPSDataItem[] => {
  const keywordResults = detectSpecificKeywords(question);
  if (keywordResults.length > 0) {
    return keywordResults.slice(0, 5);
  }
  const results = searchBPSData(question);
  if (results.length > 0) {
    return results.slice(0, 5);
  }
  const words = question.toLowerCase().split(' ').filter(word => word.length > 2);
  const partialResults: BPSDataItem[] = [];
  for (const word of words) {
    const wordResults = detectSpecificKeywords(word);
    if (wordResults.length > 0) {
      partialResults.push(...wordResults);
    } else {
      const searchResults = searchBPSData(word);
      partialResults.push(...searchResults.slice(0, 2));
    }
  }
  const uniqueResults = partialResults.filter((item, index, self) =>
    index === self.findIndex(t => t.subject_id === item.subject_id)
  );
  return uniqueResults.slice(0, 3);
};

const generatePersonalizedResponse = (question: string, questionType: string, relevantData: BPSDataItem[]): string => {
  let response = "";
  switch (questionType) {
    case 'greeting':
      return `Halo juga! 😊 Senang bertemu dengan Anda! Saya siap membantu Anda menemukan data statistik resmi BPS Kota Medan.`;
    case 'thanks':
      return "Sama-sama! 😊 Saya senang bisa membantu. Silakan tanyakan lagi jika ada yang lain!";
    case 'identity':
      return "Saya adalah AI Data Assistant khusus untuk BPS Kota Medan! 🤖 Saya diciptakan untuk membantu Anda mengakses dan mencari data statistik resmi BPS dengan mudah.";
    case 'list':
      const categories = getCategories();
      response = `Tentu! 📋 BPS Kota Medan memiliki ${categories.length} kategori utama statistik:\n\n`;
      categories.forEach((category, index) => {
        response += `${index + 1}. ${category}\n`;
      });
      return response;
  }

  if (relevantData.length > 0) {
    const primaryResult = relevantData[0];
    response += `Bagus! Saya menemukan dataset yang relevan: **${primaryResult.title}**\n\n`;
    response += `${primaryResult.description}\n\n`;
    if (relevantData.length > 1) {
      response += `Berikut juga beberapa data terkait yang mungkin berguna:\n`;
    }
    response += `Klik link di bawah untuk melihat data lengkap dari portal resmi BPS. 🔗`;
  } else {
    response += `Maaf, saya tidak menemukan data yang relevan dengan pertanyaan Anda. 🤔 Coba gunakan kata kunci yang lebih spesifik.`;
  }
  return response;
};


export default function AIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]); // ADDED
  const typingTimeoutRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [searchParams] = useSearchParams();
  const [context, setContext] = useState<ConversationContext>({
    previousTopics: [],
    userPreferences: [],
    conversationCount: 0
  });

  const simulateTyping = (fullContent: string, messageId: string, onFinish: () => void) => {
    let i = 0;
    setIsTyping(true);
    
    const interval = window.setInterval(() => {
      setMessages(prev => {
        const lastMessage = prev.find(msg => msg.id === messageId);
        if (lastMessage) {
          const updatedContent = fullContent.substring(0, i + 1);
          if (updatedContent.length >= fullContent.length) {
            window.clearInterval(interval);
            setIsTyping(false);
            onFinish();
          }
          return prev.map(msg =>
            msg.id === messageId ? { ...msg, content: updatedContent } : msg
          );
        }
        return prev;
      });
      i++;
    }, 20);
    typingTimeoutRef.current = interval;
  };
  
  const stopTyping = () => {
    if (typingTimeoutRef.current) {
      window.clearInterval(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      setIsTyping(false);
    }
    setMessages(prev => {
      const lastMessage = prev[prev.length - 1];
      if (lastMessage && lastMessage.type === "assistant") {
        return prev.map(msg =>
          msg.id === lastMessage.id ? { ...msg, content: `${msg.content}\n\n[Respon dihentikan]` } : msg
        );
      }
      return prev;
    });
  };

  const getGreetingMessage = (): string => {
    return `Halo! 👋 Saya AI Data Assistant BPS Kota Medan. Saya siap membantu Anda menemukan data statistik resmi.`;
  };

  useEffect(() => {
    if (messages.length === 0) {
      const greetingMessage: Message = {
        id: "greeting-" + Date.now(),
        content: "",
        type: "assistant",
        timestamp: new Date()
      };
      setMessages([greetingMessage]);
      simulateTyping(getGreetingMessage(), greetingMessage.id, () => {});
    }
  }, []);

  useEffect(() => {
    const queryParam = searchParams.get('q');
    if (queryParam && messages.length <= 1) {
      handleSubmit(queryParam);
    }
  }, [searchParams, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (input.length >= 2) {
      const newSuggestions = getSuggestions(input);
      setSuggestions(newSuggestions);
    } else {
      setSuggestions([]);
    }
  }, [input]);

  const handleSubmit = async (question?: string) => {
    const currentInput = question || input;
    if (!currentInput.trim() || isLoading) return;
    
    if (isTyping) {
      stopTyping();
      return;
    }

    if (editingMessageId) {
      setMessages(prev => prev.map(msg => msg.id === editingMessageId ? { ...msg, content: currentInput } : msg));
      setEditingMessageId(null);
    } else {
      const userMessage: Message = {
        id: Date.now().toString(),
        content: currentInput,
        type: "user",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, userMessage]);
    }
    
    setInput("");
    setIsLoading(true);
    
    const responseId = (Date.now() + 1).toString();
    const assistantMessagePlaceholder: Message = {
      id: responseId,
      content: "",
      type: "assistant",
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, assistantMessagePlaceholder]);

    const processingTime = Math.random() * 1000 + 1500;

    setTimeout(() => {
      const questionType = detectQuestionType(currentInput);
      const relevantData = findRelevantData(currentInput);
      const responseContent = generatePersonalizedResponse(currentInput, questionType, relevantData);
      
      simulateTyping(responseContent, responseId, () => {
        setMessages(prev => {
          return prev.map(msg => 
            msg.id === responseId 
            ? {
                ...msg,
                sources: relevantData.length > 0 ? relevantData.map(item => ({
                  title: item.title,
                  url: item.url
                })) : questionType !== 'greeting' && questionType !== 'thanks' && questionType !== 'identity' && questionType !== 'list' ? [{
                  title: "Portal Resmi BPS Kota Medan",
                  url: "https://medankota.bps.go.id/id"
                }] : undefined,
                relatedData: relevantData.length > 0 ? relevantData : undefined
              }
            : msg
          );
        });
      });
      setIsLoading(false);
    }, processingTime);
  };

  const handleEditClick = (messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setInput(content);
  };
  
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-svh bg-gray-50 dark:bg-zinc-900">
        <Sidebar className="min-h-svh" side="left" collapsible="icon">
          <SidebarHeader className="flex justify-between items-center p-4">
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-6 w-6 text-bps-primary" />
              <h1 className="text-xl font-semibold text-bps-primary">AI Assistant</h1>
            </div>
            <SidebarTrigger />
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton 
                  onClick={() => {
                    setMessages([]);
                    setInput("");
                  }}
                  className="w-full justify-start"
                >
                  <MessageSquare className="h-4 w-4" />
                  <span>New Chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div className="p-4 text-sm text-gray-500">
              <h3 className="font-semibold mb-2">Riwayat Chat</h3>
              {messages.length > 0 ? (
                messages.filter(msg => msg.type === "user").map((msg, index) => (
                  <div key={index} className="flex items-center space-x-2 py-1 cursor-pointer hover:bg-gray-200 dark:hover:bg-zinc-700 rounded-md p-2" onClick={() => handleSubmit(msg.content)}>
                    <User className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate text-gray-700 dark:text-gray-300 text-sm">{msg.content}</span>
                  </div>
                ))
              ) : (
                <p>Tidak ada riwayat chat.</p>
              )}
            </div>
          </SidebarContent>
          <SidebarFooter>
              {/* Footer content can go here if needed, or leave it empty */}
          </SidebarFooter>
        </Sidebar>
        <SidebarInset className="flex-col">
          <div className="flex-1 overflow-y-auto w-full">
            <div className="flex flex-col space-y-6 w-full max-w-4xl mx-auto px-4 py-8 md:px-8 md:py-10">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex w-full group ${message.type === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={cn(
                      "relative max-w-full md:max-w-[80%] p-4 rounded-xl shadow-sm transition-all duration-300",
                      message.type === "user"
                        ? "bg-bps-primary text-white rounded-br-none md:rounded-br-xl"
                        : "bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 rounded-bl-none md:rounded-bl-xl shadow-sm border border-gray-200 dark:border-zinc-700"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    
                    {message.type === "user" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1/2 -left-12 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleEditClick(message.id, message.content)}
                      >
                        <Edit className="h-4 w-4 text-gray-500" />
                      </Button>
                    )}
                    
                    {message.sources && (
                      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-zinc-700">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-400 mb-2">Akses Data:</p>
                        <div className="space-y-1">
                          {message.sources.map((source, index) => (
                            <a
                              key={index}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center text-xs text-bps-secondary hover:underline font-medium"
                            >
                              <ExternalLink className="h-3 w-3 mr-1" />
                              {source.title}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-zinc-800 p-4 rounded-xl rounded-bl-none md:rounded-bl-xl shadow-sm border border-gray-200 dark:border-zinc-700">
                    <div className="flex items-center space-x-2">
                      <Loader2 className="h-4 w-4 animate-spin text-bps-secondary" />
                      <span className="text-sm text-gray-600 dark:text-gray-300">Menunggu respons...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="sticky bottom-0 w-full max-w-4xl mx-auto px-4 md:px-8 bg-transparent pb-4 md:pb-8">
            <div className="w-full bg-white dark:bg-zinc-800 rounded-3xl shadow-lg border border-gray-200 dark:border-zinc-700 p-2 md:p-4">
              <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="flex space-x-2 items-end">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={editingMessageId ? "Edit pesan..." : "Tanyakan tentang data BPS Kota Medan..."}
                  className="flex-1 min-h-[2rem] md:min-h-[2.5rem] text-base resize-none overflow-hidden bg-transparent border-none focus-visible:ring-0 focus-visible:ring-offset-0"
                  disabled={isLoading}
                  style={{ height: "auto" }}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    target.style.height = 'auto';
                    target.style.height = `${target.scrollHeight}px`;
                  }}
                />
                <Button 
                  type="submit" 
                  disabled={!input.trim() || isLoading} 
                  className="h-10 w-10 p-2 rounded-full bg-bps-secondary hover:bg-bps-button-hover self-end flex-shrink-0"
                >
                  {isTyping ? (
                    <div onClick={stopTyping}>
                      <Square className="h-5 w-5" />
                    </div>
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </form>
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
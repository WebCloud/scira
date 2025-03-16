/* eslint-disable @next/next/no-img-element */
'use client';
import 'katex/dist/katex.min.css';

import { BorderTrail } from '@/components/core/border-trail';
import { TextShimmer } from '@/components/core/text-shimmer';
import { InstallPrompt } from '@/components/InstallPrompt';
import InteractiveChart from '@/components/interactive-charts';
import { MapContainer } from '@/components/map-components';
import MultiSearch from '@/components/multi-search';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn, getUserId, SearchGroupId } from '@/lib/utils';
import { CheckCircle, Info, Memory } from '@phosphor-icons/react';
import { ToolInvocation } from 'ai';
import { useChat, UseChatOptions } from '@ai-sdk/react';
import { AnimatePresence, motion } from 'framer-motion';
import { GeistMono } from 'geist/font/mono';
import {
    AlignLeft,
    ArrowRight,
    Calculator,
    Calendar,
    Check,
    ChevronDown,
    Code,
    Copy,
    FileText,
    Loader2,
    LucideIcon,
    MapPin,
    Moon,
    Play as PlayIcon,
    Plus,
    Sparkles,
    Sun,
    TrendingUp,
    User2,
    X,
    YoutubeIcon,
    RefreshCw,
    Clock,
    WrapText,
    ArrowLeftRight,
} from 'lucide-react';
import Marked, { ReactRenderer } from 'marked-react';
import { useTheme } from 'next-themes';
import Image from 'next/image';
import Link from 'next/link';
import { parseAsString, useQueryState } from 'nuqs';
import React, { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Latex from 'react-latex-next';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { toast } from 'sonner';
import { fetchMetadata, suggestQuestions } from './actions';
import { ReasoningUIPart, ToolInvocationUIPart, TextUIPart, SourceUIPart } from '@ai-sdk/ui-utils';
import FormComponent from '@/components/ui/form-component';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Separator } from '@/components/ui/separator';
import ReasonSearch from '@/components/reason-search';
import he from 'he';
import { ScrollArea } from '@/components/ui/scroll-area';
import MemoryManager from '@/components/memory-manager';

export const maxDuration = 120;

interface Attachment {
    name: string;
    contentType: string;
    url: string;
    size: number;
}

interface XResult {
    id: string;
    url: string;
    title: string;
    author?: string;
    publishedDate?: string;
    text: string;
    highlights?: string[];
    tweetId: string;
}

interface AcademicResult {
    title: string;
    url: string;
    author?: string | null;
    publishedDate?: string;
    summary: string;
}

const SearchLoadingState = ({
    icon: Icon,
    text,
    color,
}: {
    icon: LucideIcon;
    text: string;
    color: 'red' | 'green' | 'orange' | 'violet' | 'gray' | 'blue';
}) => {
    const colorVariants = {
        red: {
            background: 'bg-red-50 dark:bg-red-950',
            border: 'from-red-200 via-red-500 to-red-200 dark:from-red-400 dark:via-red-500 dark:to-red-700',
            text: 'text-red-500',
            icon: 'text-red-500',
        },
        green: {
            background: 'bg-green-50 dark:bg-green-950',
            border: 'from-green-200 via-green-500 to-green-200 dark:from-green-400 dark:via-green-500 dark:to-green-700',
            text: 'text-green-500',
            icon: 'text-green-500',
        },
        orange: {
            background: 'bg-orange-50 dark:bg-orange-950',
            border: 'from-orange-200 via-orange-500 to-orange-200 dark:from-orange-400 dark:via-orange-500 dark:to-orange-700',
            text: 'text-orange-500',
            icon: 'text-orange-500',
        },
        violet: {
            background: 'bg-violet-50 dark:bg-violet-950',
            border: 'from-violet-200 via-violet-500 to-violet-200 dark:from-violet-400 dark:via-violet-500 dark:to-violet-700',
            text: 'text-violet-500',
            icon: 'text-violet-500',
        },
        gray: {
            background: 'bg-neutral-50 dark:bg-neutral-950',
            border: 'from-neutral-200 via-neutral-500 to-neutral-200 dark:from-neutral-400 dark:via-neutral-500 dark:to-neutral-700',
            text: 'text-neutral-500',
            icon: 'text-neutral-500',
        },
        blue: {
            background: 'bg-blue-50 dark:bg-blue-950',
            border: 'from-blue-200 via-blue-500 to-blue-200 dark:from-blue-400 dark:via-blue-500 dark:to-blue-700',
            text: 'text-blue-500',
            icon: 'text-blue-500',
        },
    };

    const variant = colorVariants[color];

    return (
        <Card className="relative w-full h-[100px] my-4 overflow-hidden shadow-none">
            <BorderTrail className={cn('bg-gradient-to-l', variant.border)} size={80} />
            <CardContent className="p-6">
                <div className="relative flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div
                            className={cn(
                                'relative h-10 w-10 rounded-full flex items-center justify-center',
                                variant.background,
                            )}
                        >
                            <BorderTrail className={cn('bg-gradient-to-l', variant.border)} size={40} />
                            <Icon className={cn('h-5 w-5', variant.icon)} />
                        </div>
                        <div className="space-y-2">
                            <TextShimmer className="text-base font-medium" duration={2}>
                                {text}
                            </TextShimmer>
                            <div className="flex gap-2">
                                {[...Array(3)].map((_, i) => (
                                    <div
                                        key={i}
                                        className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 animate-pulse"
                                        style={{
                                            width: `${Math.random() * 40 + 20}px`,
                                            animationDelay: `${i * 0.2}s`,
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

interface VideoDetails {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
    type?: string;
    provider_name?: string;
    provider_url?: string;
    height?: number;
    width?: number;
}

interface VideoResult {
    videoId: string;
    url: string;
    details?: VideoDetails;
    captions?: string;
    timestamps?: string[];
    views?: string;
    likes?: string;
    summary?: string;
}

interface YouTubeSearchResponse {
    results: VideoResult[];
}

interface YouTubeCardProps {
    video: VideoResult;
    index: number;
}

const VercelIcon = ({ size = 16 }: { size: number }) => {
    return (
        <svg height={size} strokeLinejoin="round" viewBox="0 0 16 16" width={size} style={{ color: 'currentcolor' }}>
            <path fillRule="evenodd" clipRule="evenodd" d="M8 1L16 15H0L8 1Z" fill="currentColor"></path>
        </svg>
    );
};

const IconMapping: Record<string, LucideIcon> = {
    stock: TrendingUp,
    default: Code,
    date: Calendar,
    calculation: Calculator,
    output: FileText,
};

interface CollapsibleSectionProps {
    code: string;
    output?: string;
    language?: string;
    title?: string;
    icon?: string;
    status?: 'running' | 'completed';
}

function CollapsibleSection({ code, output, language = 'plaintext', title, icon, status }: CollapsibleSectionProps) {
    const [copied, setCopied] = React.useState(false);
    const [isExpanded, setIsExpanded] = React.useState(true);
    const [activeTab, setActiveTab] = React.useState<'code' | 'output'>('code');
    const { theme } = useTheme();
    const IconComponent = icon ? IconMapping[icon] : null;

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const textToCopy = activeTab === 'code' ? code : output;
        await navigator.clipboard.writeText(textToCopy || '');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="group rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden transition-all duration-200 hover:shadow-sm">
            <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer bg-white dark:bg-neutral-900 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-3">
                    {IconComponent && (
                        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800">
                            <IconComponent className="h-4 w-4 text-primary" />
                        </div>
                    )}
                    <h3 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{title}</h3>
                </div>
                <div className="flex items-center gap-2">
                    {status && (
                        <Badge
                            variant="secondary"
                            className={cn(
                                'w-fit flex items-center gap-1.5 px-1.5 py-0.5 text-xs',
                                status === 'running'
                                    ? 'bg-blue-50/50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                                    : 'bg-green-50/50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
                            )}
                        >
                            {status === 'running' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <CheckCircle className="h-3 w-3" />
                            )}
                            {status === 'running' ? 'Running' : 'Done'}
                        </Badge>
                    )}
                    <ChevronDown
                        className={cn('h-4 w-4 transition-transform duration-200', !isExpanded && '-rotate-90')}
                    />
                </div>
            </div>

            {isExpanded && (
                <div>
                    <div className="flex border-b border-neutral-200 dark:border-neutral-800">
                        <button
                            className={cn(
                                'px-4 py-2 text-sm font-medium transition-colors',
                                activeTab === 'code'
                                    ? 'border-b-2 border-primary text-primary'
                                    : 'text-neutral-600 dark:text-neutral-400',
                            )}
                            onClick={() => setActiveTab('code')}
                        >
                            Code
                        </button>
                        {output && (
                            <button
                                className={cn(
                                    'px-4 py-2 text-sm font-medium transition-colors',
                                    activeTab === 'output'
                                        ? 'border-b-2 border-primary text-primary'
                                        : 'text-neutral-600 dark:text-neutral-400',
                                )}
                                onClick={() => setActiveTab('output')}
                            >
                                Output
                            </button>
                        )}
                        <div className="ml-auto pr-2 flex items-center">
                            <Button
                                size="sm"
                                variant="ghost"
                                className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                                onClick={handleCopy}
                            >
                                {copied ? (
                                    <Check className="h-3.5 w-3.5 text-green-500" />
                                ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                )}
                            </Button>
                        </div>
                    </div>
                    <div className={cn('text-sm', theme === 'dark' ? 'bg-[rgb(40,44,52)]' : 'bg-[rgb(250,250,250)]')}>
                        <SyntaxHighlighter
                            language={activeTab === 'code' ? language : 'plaintext'}
                            style={theme === 'dark' ? oneDark : oneLight}
                            customStyle={{
                                margin: 0,
                                padding: '0.75rem 0 0 0',
                                backgroundColor: theme === 'dark' ? '#000000' : 'transparent',
                                borderRadius: 0,
                                borderBottomLeftRadius: '0.375rem',
                                borderBottomRightRadius: '0.375rem',
                                fontFamily: GeistMono.style.fontFamily,
                            }}
                            showLineNumbers={true}
                            lineNumberStyle={{
                                textAlign: 'right',
                                color: '#808080',
                                backgroundColor: 'transparent',
                                fontStyle: 'normal',
                                marginRight: '1em',
                                paddingRight: '0.5em',
                                fontFamily: GeistMono.style.fontFamily,
                                minWidth: '2em',
                            }}
                            lineNumberContainerStyle={{
                                backgroundColor: theme === 'dark' ? '#000000' : '#f5f5f5',
                                float: 'left',
                            }}
                            wrapLongLines={false}
                            codeTagProps={{
                                style: {
                                    fontFamily: GeistMono.style.fontFamily,
                                    fontSize: '0.85em',
                                    whiteSpace: 'pre',
                                    overflowWrap: 'normal',
                                    wordBreak: 'keep-all',
                                },
                            }}
                        >
                            {activeTab === 'code' ? code : output || ''}
                        </SyntaxHighlighter>
                    </div>
                </div>
            )}
        </div>
    );
}

const YouTubeCard: React.FC<YouTubeCardProps> = ({ video, index }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    if (!video) return null;

    // Format timestamp for accessibility
    const formatTimestamp = (timestamp: string) => {
        const match = timestamp.match(/(\d+:\d+(?::\d+)?) - (.+)/);
        if (match) {
            const [_, time, description] = match;
            return { time, description };
        }
        return { time: '', description: timestamp };
    };

    // Prevent event propagation to allow scrolling during streaming
    const handleScrollableAreaEvents = (e: React.UIEvent) => {
        e.stopPropagation();
    };

    return (
        <div
            className="w-[280px] flex-shrink-0 rounded-lg border dark:border-neutral-800 border-neutral-200 overflow-hidden bg-white dark:bg-neutral-900 shadow-sm hover:shadow-md transition-shadow duration-200"
            onTouchStart={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            <Link
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative aspect-video block bg-neutral-100 dark:bg-neutral-800 overflow-hidden"
                aria-label={`Watch ${video.details?.title || 'YouTube video'}`}
            >
                {video.details?.thumbnail_url ? (
                    <img
                        src={video.details.thumbnail_url}
                        alt=""
                        aria-hidden="true"
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <YoutubeIcon className="h-8 w-8 text-red-500" />
                    </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="absolute bottom-2 left-2 right-2 text-white text-xs font-medium line-clamp-2">
                        {video.details?.title || 'YouTube Video'}
                    </div>
                    <div className="rounded-full bg-white/90 p-2">
                        <PlayIcon className="h-6 w-6 text-red-600" />
                    </div>
                </div>
            </Link>

            <div className="p-3 flex flex-col gap-2">
                <div>
                    <Link
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium line-clamp-2 hover:text-red-500 transition-colors dark:text-neutral-100"
                    >
                        {video.details?.title || 'YouTube Video'}
                    </Link>

                    {video.details?.author_name && (
                        <Link
                            href={video.details.author_url || video.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 group mt-1.5 w-fit"
                            aria-label={`Channel: ${video.details.author_name}`}
                        >
                            <div className="h-5 w-5 rounded-full bg-red-50 dark:bg-red-950 flex items-center justify-center flex-shrink-0">
                                <User2 className="h-3 w-3 text-red-500" />
                            </div>
                            <span className="text-xs text-neutral-600 dark:text-neutral-400 group-hover:text-red-500 transition-colors truncate">
                                {video.details.author_name}
                            </span>
                        </Link>
                    )}
                </div>

                {((video.timestamps && video.timestamps?.length > 0) || video.captions) && (
                    <div className="mt-1">
                        <Accordion type="single" collapsible>
                            <AccordionItem value="details" className="border-none">
                                <AccordionTrigger className="py-1 hover:no-underline">
                                    <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 hover:text-red-500 dark:hover:text-red-400">
                                        {isExpanded ? 'Hide details' : 'Show details'}
                                    </span>
                                </AccordionTrigger>
                                <AccordionContent>
                                    {video.timestamps && video.timestamps.length > 0 && (
                                        <div className="mt-2 space-y-1.5">
                                            <h4 className="text-xs font-semibold dark:text-neutral-300 text-neutral-700">
                                                Key Moments
                                            </h4>
                                            <ScrollArea className="h-[120px]">
                                                <div className="pr-4">
                                                    {video.timestamps.map((timestamp, i) => {
                                                        const { time, description } = formatTimestamp(timestamp);
                                                        return (
                                                            <Link
                                                                key={i}
                                                                href={`${video.url}&t=${time
                                                                    .split(':')
                                                                    .reduce((acc, time, i, arr) => {
                                                                        if (arr.length === 2) {
                                                                            // MM:SS format
                                                                            return i === 0
                                                                                ? acc + parseInt(time) * 60
                                                                                : acc + parseInt(time);
                                                                        } else {
                                                                            // HH:MM:SS format
                                                                            return i === 0
                                                                                ? acc + parseInt(time) * 3600
                                                                                : i === 1
                                                                                ? acc + parseInt(time) * 60
                                                                                : acc + parseInt(time);
                                                                        }
                                                                    }, 0)}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="flex items-start gap-2 py-1 px-1.5 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
                                                            >
                                                                <span className="text-xs font-medium text-red-500 whitespace-nowrap">
                                                                    {time}
                                                                </span>
                                                                <span className="text-xs text-neutral-700 dark:text-neutral-300 line-clamp-1">
                                                                    {description}
                                                                </span>
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            </ScrollArea>
                                        </div>
                                    )}

                                    {video.captions && (
                                        <div className="mt-3 space-y-1.5">
                                            <h4 className="text-xs font-semibold dark:text-neutral-300 text-neutral-700">
                                                Transcript
                                            </h4>
                                            <ScrollArea className="h-[120px]">
                                                <div className="text-xs dark:text-neutral-400 text-neutral-600 rounded bg-neutral-50 dark:bg-neutral-800 p-2">
                                                    <p className="whitespace-pre-wrap">{video.captions}</p>
                                                </div>
                                            </ScrollArea>
                                        </div>
                                    )}
                                </AccordionContent>
                            </AccordionItem>
                        </Accordion>
                    </div>
                )}
            </div>
        </div>
    );
};

// Memoize the YouTubeCard component with a more comprehensive equality function
const MemoizedYouTubeCard = React.memo(YouTubeCard, (prevProps, nextProps) => {
    // Deep comparison of video properties that matter for rendering
    return (
        prevProps.video.videoId === nextProps.video.videoId &&
        prevProps.index === nextProps.index &&
        prevProps.video.url === nextProps.video.url &&
        JSON.stringify(prevProps.video.details) === JSON.stringify(nextProps.video.details)
    );
});

const HomeContent = () => {
    const [query] = useQueryState('query', parseAsString.withDefault(''));
    const [q] = useQueryState('q', parseAsString.withDefault(''));
    const [model] = useQueryState('model', parseAsString.withDefault('scira-default'));

    const initialState = useMemo(
        () => ({
            query: query || q,
            model: model,
        }),
        [query, q, model],
    );

    const lastSubmittedQueryRef = useRef(initialState.query);
    const [selectedModel, setSelectedModel] = useState(initialState.model);
    const bottomRef = useRef<HTMLDivElement>(null);
    const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
    const [isEditingMessage, setIsEditingMessage] = useState(false);
    const [editingMessageIndex, setEditingMessageIndex] = useState(-1);
    const [attachments, setAttachments] = useState<Attachment[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const initializedRef = useRef(false);
    const [selectedGroup, setSelectedGroup] = useState<SearchGroupId>('web');
    const [hasSubmitted, setHasSubmitted] = React.useState(false);
    const [hasManuallyScrolled, setHasManuallyScrolled] = useState(false);
    const isAutoScrollingRef = useRef(false);

    // Get stored user ID
    const userId = useMemo(() => getUserId(), []);

    const chatOptions: UseChatOptions = useMemo(
        () => ({
            api: '/api/search',
            experimental_throttle: 500,
            body: {
                model: selectedModel,
                group: selectedGroup,
                user_id: userId,
            },
            onFinish: async (message, { finishReason }) => {
                console.log('[finish reason]:', finishReason);
                if (message.content && (finishReason === 'stop' || finishReason === 'length')) {
                    const newHistory = [
                        { role: 'user', content: lastSubmittedQueryRef.current },
                        { role: 'assistant', content: message.content },
                    ];
                    const { questions } = await suggestQuestions(newHistory);
                    setSuggestedQuestions(questions);
                }
            },
            onError: (error) => {
                console.error('Chat error:', error.cause, error.message);
                toast.error('An error occurred.', {
                    description: `Oops! An error occurred while processing your request. ${error.message}`,
                });
            },
        }),
        [selectedModel, selectedGroup, userId],
    );

    const { input, messages, setInput, append, handleSubmit, setMessages, reload, stop, status } = useChat(chatOptions);

    useEffect(() => {
        if (!initializedRef.current && initialState.query && !messages.length) {
            initializedRef.current = true;
            console.log('[initial query]:', initialState.query);
            append({
                content: initialState.query,
                role: 'user',
            });
        }
    }, [initialState.query, append, setInput, messages.length]);

    const ThemeToggle: React.FC = () => {
        const { resolvedTheme, setTheme } = useTheme();

        return (
            <Button
                variant="ghost"
                size="icon"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                className="bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
                <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
            </Button>
        );
    };

    const CopyButton = ({ text }: { text: string }) => {
        const [isCopied, setIsCopied] = useState(false);

        return (
            <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                    if (!navigator.clipboard) {
                        return;
                    }
                    await navigator.clipboard.writeText(text);
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    toast.success('Copied to clipboard');
                }}
                className="h-8 px-2 text-xs rounded-full"
            >
                {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
        );
    };

    interface MarkdownRendererProps {
        content: string;
    }

    interface CitationLink {
        text: string;
        link: string;
    }

    interface LinkMetadata {
        title: string;
        description: string;
    }

    const isValidUrl = (str: string) => {
        try {
            new URL(str);
            return true;
        } catch {
            return false;
        }
    };

    const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
        const [metadataCache, setMetadataCache] = useState<Record<string, LinkMetadata>>({});

        const citationLinks = useMemo<CitationLink[]>(() => {
            return Array.from(content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)).map(([_, text, link]) => ({ text, link }));
        }, [content]);

        const fetchMetadataWithCache = useCallback(
            async (url: string) => {
                if (metadataCache[url]) {
                    return metadataCache[url];
                }
                const metadata = await fetchMetadata(url);
                if (metadata) {
                    setMetadataCache((prev) => ({ ...prev, [url]: metadata }));
                }
                return metadata;
            },
            [metadataCache],
        );

        interface CodeBlockProps {
            language: string | undefined;
            children: string;
        }

        const CodeBlock: React.FC<CodeBlockProps> = ({ language, children }) => {
            const [isCopied, setIsCopied] = useState(false);
            const [isWrapped, setIsWrapped] = useState(false);
            const { theme } = useTheme();

            const handleCopy = useCallback(async () => {
                await navigator.clipboard.writeText(children);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
            }, [children]);

            const toggleWrap = useCallback(() => {
                setIsWrapped((prev) => !prev);
            }, []);

            return (
                <div className="group my-5 relative">
                    <div className="rounded-md overflow-hidden border border-neutral-200 dark:border-neutral-800 shadow-sm">
                        <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700">
                            <div className="px-2 py-0.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                                {language || 'text'}
                            </div>
                            <div className="flex items-center gap-1.5">
                                <button
                                    onClick={toggleWrap}
                                    className={`
                                      px-2 py-1
                                      rounded text-xs font-medium
                                      transition-all duration-200
                                      ${isWrapped ? 'text-primary' : 'text-neutral-500 dark:text-neutral-400'}
                                      hover:bg-neutral-200 dark:hover:bg-neutral-700
                                      flex items-center gap-1.5
                                    `}
                                    aria-label="Toggle line wrapping"
                                >
                                    {isWrapped ? (
                                        <>
                                            <ArrowLeftRight className="h-3 w-3" />
                                            <span className="hidden sm:inline">Unwrap</span>
                                        </>
                                    ) : (
                                        <>
                                            <WrapText className="h-3 w-3" />
                                            <span className="hidden sm:inline">Wrap</span>
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={handleCopy}
                                    className={`
                                      px-2 py-1
                                      rounded text-xs font-medium
                                      transition-all duration-200
                                      ${
                                          isCopied
                                              ? 'text-primary dark:text-primary'
                                              : 'text-neutral-500 dark:text-neutral-400'
                                      }
                                      hover:bg-neutral-200 dark:hover:bg-neutral-700
                                      flex items-center gap-1.5
                                    `}
                                    aria-label="Copy code"
                                >
                                    {isCopied ? (
                                        <>
                                            <Check className="h-3 w-3" />
                                            <span className="hidden sm:inline">Copied!</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="h-3 w-3" />
                                            <span className="hidden sm:inline">Copy</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                        <SyntaxHighlighter
                            language={language || 'text'}
                            style={theme === 'dark' ? oneDark : oneLight}
                            customStyle={{
                                margin: 0,
                                padding: '0.75rem 0.25rem 0.75rem',
                                backgroundColor: theme === 'dark' ? '#171717' : 'transparent',
                                borderRadius: 0,
                                borderBottomLeftRadius: '0.375rem',
                                borderBottomRightRadius: '0.375rem',
                                fontFamily: GeistMono.style.fontFamily,
                            }}
                            showLineNumbers={true}
                            lineNumberStyle={{
                                textAlign: 'right',
                                color: theme === 'dark' ? '#6b7280' : '#808080',
                                backgroundColor: 'transparent',
                                fontStyle: 'normal',
                                marginRight: '1em',
                                paddingRight: '0.5em',
                                fontFamily: GeistMono.style.fontFamily,
                                minWidth: '2em',
                            }}
                            lineNumberContainerStyle={{
                                backgroundColor: theme === 'dark' ? '#171717' : '#f5f5f5',
                                float: 'left',
                            }}
                            wrapLongLines={isWrapped}
                            codeTagProps={{
                                style: {
                                    fontFamily: GeistMono.style.fontFamily,
                                    fontSize: '0.85em',
                                    whiteSpace: isWrapped ? 'pre-wrap' : 'pre',
                                    overflowWrap: isWrapped ? 'break-word' : 'normal',
                                    wordBreak: isWrapped ? 'break-word' : 'keep-all',
                                },
                            }}
                        >
                            {children}
                        </SyntaxHighlighter>
                    </div>
                </div>
            );
        };

        CodeBlock.displayName = 'CodeBlock';

        const LinkPreview = ({ href }: { href: string }) => {
            const [metadata, setMetadata] = useState<LinkMetadata | null>(null);
            const [isLoading, setIsLoading] = useState(false);

            React.useEffect(() => {
                setIsLoading(true);
                fetchMetadataWithCache(href).then((data) => {
                    setMetadata(data);
                    setIsLoading(false);
                });
            }, [href]);

            if (isLoading) {
                return (
                    <div className="flex items-center justify-center h-8">
                        <Loader2 className="h-3 w-3 animate-spin text-neutral-500 dark:text-neutral-400" />
                    </div>
                );
            }

            const domain = new URL(href).hostname;
            const decodedTitle = metadata?.title ? he.decode(metadata.title) : '';

            return (
                <div className="flex flex-col bg-white dark:bg-neutral-800 text-xs m-0">
                    <div className="flex items-center h-6 space-x-1.5 px-2 pt-1.5 text-[10px] text-neutral-500 dark:text-neutral-400">
                        <Image
                            src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
                            alt=""
                            width={10}
                            height={10}
                            className="rounded-sm"
                        />
                        <span className="truncate">{domain}</span>
                    </div>
                    {decodedTitle && (
                        <div className="px-2 pb-1.5">
                            <h3 className="font-medium text-sm m-0 text-neutral-800 dark:text-neutral-200 line-clamp-2">
                                {decodedTitle}
                            </h3>
                        </div>
                    )}
                </div>
            );
        };

        const renderHoverCard = (href: string, text: React.ReactNode, isCitation: boolean = false) => {
            return (
                <HoverCard>
                    <HoverCardTrigger asChild>
                        <Link
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={
                                isCitation
                                    ? 'cursor-pointer text-xs text-primary py-0.5 px-1.5 m-0 bg-primary/10 dark:bg-primary/20 rounded-full no-underline font-medium'
                                    : 'text-primary dark:text-primary-light no-underline hover:underline font-medium'
                            }
                        >
                            {text}
                        </Link>
                    </HoverCardTrigger>
                    <HoverCardContent
                        side="top"
                        align="start"
                        sideOffset={5}
                        className="w-48 p-0 shadow-sm border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden"
                    >
                        <LinkPreview href={href} />
                    </HoverCardContent>
                </HoverCard>
            );
        };

        const renderer: Partial<ReactRenderer> = {
            text(text: string) {
                if (!text.includes('$')) return text;
                return (
                    <Latex
                        delimiters={[
                            { left: '$$', right: '$$', display: true },
                            { left: '$', right: '$', display: false },
                        ]}
                    >
                        {text}
                    </Latex>
                );
            },
            paragraph(children) {
                if (typeof children === 'string' && children.includes('$')) {
                    return (
                        <p className="my-5 leading-relaxed text-neutral-700 dark:text-neutral-300">
                            <Latex
                                delimiters={[
                                    { left: '$$', right: '$$', display: true },
                                    { left: '$', right: '$', display: false },
                                ]}
                            >
                                {children}
                            </Latex>
                        </p>
                    );
                }
                return <p className="my-5 leading-relaxed text-neutral-700 dark:text-neutral-300">{children}</p>;
            },
            code(children, language) {
                return <CodeBlock language={language}>{String(children)}</CodeBlock>;
            },
            link(href, text) {
                const citationIndex = citationLinks.findIndex((link) => link.link === href);
                if (citationIndex !== -1) {
                    return <sup>{renderHoverCard(href, citationIndex + 1, true)}</sup>;
                }
                return isValidUrl(href) ? (
                    renderHoverCard(href, text)
                ) : (
                    <a href={href} className="text-primary dark:text-primary-light hover:underline font-medium">
                        {text}
                    </a>
                );
            },
            heading(children, level) {
                const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
                const sizeClasses =
                    {
                        1: 'text-2xl md:text-3xl font-extrabold mt-8 mb-4',
                        2: 'text-xl md:text-2xl font-bold mt-7 mb-3',
                        3: 'text-lg md:text-xl font-semibold mt-6 mb-3',
                        4: 'text-base md:text-lg font-medium mt-5 mb-2',
                        5: 'text-sm md:text-base font-medium mt-4 mb-2',
                        6: 'text-xs md:text-sm font-medium mt-4 mb-2',
                    }[level] || '';

                return (
                    <HeadingTag className={`${sizeClasses} text-neutral-900 dark:text-neutral-50 tracking-tight`}>
                        {children}
                    </HeadingTag>
                );
            },
            list(children, ordered) {
                const ListTag = ordered ? 'ol' : 'ul';
                return (
                    <ListTag
                        className={`my-5 pl-6 space-y-2 text-neutral-700 dark:text-neutral-300 ${
                            ordered ? 'list-decimal' : 'list-disc'
                        }`}
                    >
                        {children}
                    </ListTag>
                );
            },
            listItem(children) {
                return <li className="pl-1 leading-relaxed">{children}</li>;
            },
            blockquote(children) {
                return (
                    <blockquote className="my-6 border-l-4 border-primary/30 dark:border-primary/20 pl-4 py-1 text-neutral-700 dark:text-neutral-300 italic bg-neutral-50 dark:bg-neutral-900/50 rounded-r-md">
                        {children}
                    </blockquote>
                );
            },
            table(children) {
                return (
                    <div className="w-full my-8 overflow-hidden">
                        <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm">
                            <table className="w-full border-collapse text-sm m-0">{children}</table>
                        </div>
                    </div>
                );
            },
            tableRow(children) {
                return (
                    <tr className="border-b border-neutral-200 dark:border-neutral-800 last:border-0 transition-colors hover:bg-neutral-50/80 dark:hover:bg-neutral-800/50">
                        {children}
                    </tr>
                );
            },
            tableCell(children, flags) {
                const align = flags.align ? `text-${flags.align}` : 'text-left';
                const isHeader = flags.header;

                return isHeader ? (
                    <th
                        className={cn(
                            'px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100',
                            'bg-neutral-100/80 dark:bg-neutral-800/80',
                            'first:pl-6 last:pr-6',
                            align,
                        )}
                    >
                        {children}
                    </th>
                ) : (
                    <td
                        className={cn(
                            'px-4 py-3 text-neutral-700 dark:text-neutral-300',
                            'first:pl-6 last:pr-6',
                            align,
                        )}
                    >
                        {children}
                    </td>
                );
            },
            tableHeader(children) {
                return <thead className="border-b border-neutral-200 dark:border-neutral-800">{children}</thead>;
            },
            tableBody(children) {
                return <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">{children}</tbody>;
            },
        };

        return (
            <div className="markdown-body prose prose-neutral dark:prose-invert max-w-none dark:text-neutral-200 font-sans">
                <Marked renderer={renderer}>{content}</Marked>
            </div>
        );
    };

    const lastUserMessageIndex = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') {
                return i;
            }
        }
        return -1;
    }, [messages]);

    useEffect(() => {
        // Reset manual scroll when streaming starts
        if (status === 'streaming') {
            setHasManuallyScrolled(false);
            // Initial scroll to bottom when streaming starts
            if (bottomRef.current) {
                isAutoScrollingRef.current = true;
                bottomRef.current.scrollIntoView({ behavior: 'smooth' });
            }
        }
    }, [status]);

    useEffect(() => {
        let scrollTimeout: NodeJS.Timeout;

        const handleScroll = () => {
            // Clear any pending timeout
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }

            // If we're not auto-scrolling and we're streaming, it must be a user scroll
            if (!isAutoScrollingRef.current && status === 'streaming') {
                const isAtBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 100;
                if (!isAtBottom) {
                    setHasManuallyScrolled(true);
                }
            }
        };

        window.addEventListener('scroll', handleScroll);

        // Auto-scroll on new content if we haven't manually scrolled
        if (status === 'streaming' && !hasManuallyScrolled && bottomRef.current) {
            scrollTimeout = setTimeout(() => {
                isAutoScrollingRef.current = true;
                bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
                // Reset auto-scroll flag after animation
                setTimeout(() => {
                    isAutoScrollingRef.current = false;
                }, 100);
            }, 100);
        }

        return () => {
            window.removeEventListener('scroll', handleScroll);
            if (scrollTimeout) {
                clearTimeout(scrollTimeout);
            }
        };
    }, [messages, suggestedQuestions, status, hasManuallyScrolled]);

    const handleSuggestedQuestionClick = useCallback(
        async (question: string) => {
            setSuggestedQuestions([]);

            await append({
                content: question.trim(),
                role: 'user',
            });
        },
        [append],
    );

    const handleMessageEdit = useCallback(
        (index: number) => {
            setIsEditingMessage(true);
            setEditingMessageIndex(index);
            setInput(messages[index].content);
        },
        [messages, setInput],
    );

    const handleMessageUpdate = useCallback(
        (e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            if (input.trim()) {
                // Create new messages array up to the edited message
                const newMessages = messages.slice(0, editingMessageIndex + 1);
                // Update the edited message
                newMessages[editingMessageIndex] = { ...newMessages[editingMessageIndex], content: input.trim() };
                // Set the new messages array
                setMessages(newMessages);
                // Reset editing state
                setIsEditingMessage(false);
                setEditingMessageIndex(-1);
                // Store the edited message for reference
                lastSubmittedQueryRef.current = input.trim();
                // Clear input
                setInput('');
                // Reset suggested questions
                setSuggestedQuestions([]);
                // Trigger a new chat completion without appending
                reload();
            } else {
                toast.error('Please enter a valid message.');
            }
        },
        [input, messages, editingMessageIndex, setMessages, setInput, reload],
    );

    const AboutButton = () => {
        return (
            <Link href="/about">
                <Button
                    variant="outline"
                    size="icon"
                    className="rounded-full w-8 h-8 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all"
                >
                    <Info className="h-5 w-5 text-neutral-600 dark:text-neutral-400" />
                </Button>
            </Link>
        );
    };

    interface NavbarProps {}

    const Navbar: React.FC<NavbarProps> = () => {
        return (
            <div
                className={cn(
                    'fixed top-0 left-0 right-0 z-[60] flex justify-between items-center p-4',
                    // Add opaque background only after submit
                    status === 'ready'
                        ? 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'
                        : 'bg-background',
                )}
            >
                <div className="flex items-center gap-4">
                    <Link href="/new">
                        <Button
                            type="button"
                            variant={'secondary'}
                            className="rounded-full bg-accent hover:bg-accent/80 backdrop-blur-sm group transition-all hover:scale-105 pointer-events-auto"
                        >
                            <Plus size={18} className="group-hover:rotate-90 transition-all" />
                            <span className="text-sm ml-2 group-hover:block hidden animate-in fade-in duration-300">
                                New
                            </span>
                        </Button>
                    </Link>
                </div>
                <div className="flex items-center space-x-4">
                    <Link
                        target="_blank"
                        href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fzaidmukaddam%2Fscira&env=XAI_API_KEY,ANTHROPIC_API_KEY,CEREBRAS_API_KEY,GROQ_API_KEY,E2B_API_KEY,ELEVENLABS_API_KEY,TAVILY_API_KEY,EXA_API_KEY,TMDB_API_KEY,YT_ENDPOINT,FIRECRAWL_API_KEY,OPENWEATHER_API_KEY,SANDBOX_TEMPLATE_ID,GOOGLE_MAPS_API_KEY,MAPBOX_ACCESS_TOKEN,TRIPADVISOR_API_KEY,AVIATION_STACK_API_KEY,CRON_SECRET,BLOB_READ_WRITE_TOKEN,NEXT_PUBLIC_MAPBOX_TOKEN,NEXT_PUBLIC_POSTHOG_KEY,NEXT_PUBLIC_POSTHOG_HOST,NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,MEM0_API_KEY,MEM0_ORG_NAME,MEM0_PROJECT_NAME&envDescription=API%20keys%20and%20configuration%20required%20for%20Scira%20to%20function"
                        className="flex flex-row gap-2 items-center py-1.5 px-2 rounded-md 
                            bg-accent hover:bg-accent/80
                            backdrop-blur-sm text-foreground shadow-sm text-sm
                            transition-all duration-200"
                    >
                        <VercelIcon size={14} />
                        <span className="hidden sm:block">Deploy with Vercel</span>
                        <span className="sm:hidden block">Deploy</span>
                    </Link>
                    <AboutButton />
                    <ThemeToggle />
                </div>
            </div>
        );
    };

    const handleModelChange = useCallback((newModel: string) => {
        setSelectedModel(newModel);
        setSuggestedQuestions([]);
    }, []);

    const resetSuggestedQuestions = useCallback(() => {
        setSuggestedQuestions([]);
    }, []);

    const memoizedMessages = useMemo(() => {
        // Create a shallow copy
        const msgs = [...messages];

        return msgs.filter((message) => {
            // Keep all user messages
            if (message.role === 'user') return true;

            // For assistant messages
            if (message.role === 'assistant') {
                // Keep messages that have tool invocations
                if (message.parts?.some((part) => part.type === 'tool-invocation')) {
                    return true;
                }
                // Keep messages that have text parts but no tool invocations
                if (
                    message.parts?.some((part) => part.type === 'text') ||
                    !message.parts?.some((part) => part.type === 'tool-invocation')
                ) {
                    return true;
                }
                return false;
            }
            return false;
        });
    }, [messages]);

    // Track visibility state for each reasoning section using messageIndex-partIndex as key
    const [reasoningVisibilityMap, setReasoningVisibilityMap] = useState<Record<string, boolean>>({});

    const handleRegenerate = useCallback(async () => {
        if (status !== 'ready') {
            toast.error('Please wait for the current response to complete!');
            return;
        }

        const lastUserMessage = messages.findLast((m) => m.role === 'user');
        if (!lastUserMessage) return;

        // Remove the last assistant message
        const newMessages = messages.slice(0, -1);
        setMessages(newMessages);
        setSuggestedQuestions([]);

        // Resubmit the last user message
        await reload();
    }, [status, messages, setMessages, reload]);

    // Add this type at the top with other interfaces
    type MessagePart = TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart;

    // Update the renderPart function signature
    const renderPart = (
        part: MessagePart,
        messageIndex: number,
        partIndex: number,
        parts: MessagePart[],
        message: any,
    ) => {
        if (
            part.type === 'text' &&
            partIndex === 0 &&
            parts.some((p, i) => i > partIndex && p.type === 'tool-invocation')
        ) {
            return null;
        }
        console.log('######################### part #################################', part);

        switch (part.type) {
            case 'text':
                if (part.text.trim() === '' || part.text === null || part.text === undefined || !part.text) {
                    return null;
                }
                return (
                    <div key={`${messageIndex}-${partIndex}-text`}>
                        <div className="flex items-center justify-between mt-5 mb-2">
                            <div className="flex items-center gap-2">
                                <Sparkles className="size-5 text-primary" />
                                <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
                                    Answer
                                </h2>
                            </div>
                            {status === 'ready' && (
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleRegenerate()}
                                        className="h-8 px-2 text-xs rounded-full"
                                    >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                    </Button>
                                    <CopyButton text={part.text} />
                                </div>
                            )}
                        </div>
                        <MarkdownRenderer content={part.text} />
                    </div>
                );
            case 'reasoning': {
                const sectionKey = `${messageIndex}-${partIndex}`;
                const isComplete = parts[partIndex + 1]?.type === 'text';
                const timing = reasoningTimings[sectionKey];
                const duration = timing?.endTime ? ((timing.endTime - timing.startTime) / 1000).toFixed(1) : null;

                return (
                    <motion.div
                        key={`${messageIndex}-${partIndex}-reasoning`}
                        id={`reasoning-${messageIndex}`}
                        className="my-4"
                    >
                        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
                            <button
                                onClick={() =>
                                    setReasoningVisibilityMap((prev) => ({
                                        ...prev,
                                        [sectionKey]: !prev[sectionKey],
                                    }))
                                }
                                className={cn(
                                    'w-full flex items-center justify-between px-4 py-3',
                                    'bg-neutral-50 dark:bg-neutral-900',
                                    'hover:bg-neutral-100 dark:hover:bg-neutral-800',
                                    'transition-colors duration-200',
                                    'group text-left',
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className="relative flex items-center justify-center size-2">
                                        <div className="relative flex items-center justify-center size-2">
                                            {isComplete ? (
                                                <div className="size-1.5 rounded-full bg-emerald-500" />
                                            ) : (
                                                <>
                                                    <div className="size-1.5 rounded-full bg-[#007AFF]/30 animate-ping" />
                                                    <div className="size-1.5 rounded-full bg-[#007AFF] absolute" />
                                                </>
                                            )}
                                        </div>
                                        {!isComplete && (
                                            <div className="absolute inset-0 rounded-full border-2 border-[#007AFF]/20 animate-ping" />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                                            {isComplete ? 'Reasoned' : 'Reasoning'}
                                        </span>
                                        {duration && (
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800">
                                                <Clock className="size-3 text-neutral-500" />
                                                <span className="text-[10px] tabular-nums font-medium text-neutral-500">
                                                    {duration}s
                                                </span>
                                            </div>
                                        )}
                                        {!isComplete && liveElapsedTimes[sectionKey] && (
                                            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800">
                                                <Clock className="size-3 text-neutral-500" />
                                                <span className="text-[10px] tabular-nums font-medium text-neutral-500">
                                                    {liveElapsedTimes[sectionKey].toFixed(1)}s
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!isComplete && (
                                        <div className="flex items-center gap-[3px] px-2 py-1">
                                            {[...Array(3)].map((_, i) => (
                                                <div
                                                    key={i}
                                                    className="size-1 rounded-full bg-primary/60 animate-pulse"
                                                    style={{ animationDelay: `${i * 200}ms` }}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <ChevronDown
                                        className={cn(
                                            'size-4 text-neutral-400 transition-transform duration-200',
                                            reasoningVisibilityMap[sectionKey] ? 'rotate-180' : '',
                                        )}
                                    />
                                </div>
                            </button>

                            <AnimatePresence>
                                {reasoningVisibilityMap[sectionKey] && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="overflow-hidden border-t border-neutral-200 dark:border-neutral-800"
                                    >
                                        <div className="p-4 bg-white dark:bg-neutral-900">
                                            <div
                                                className={cn(
                                                    'text-sm text-neutral-600 dark:text-neutral-400',
                                                    'prose prose-neutral dark:prose-invert max-w-none',
                                                    'prose-p:my-2 prose-p:leading-relaxed',
                                                )}
                                            >
                                                {part.details ? (
                                                    <div className="whitespace-pre-wrap">
                                                        {part.details.map((detail, detailIndex) => (
                                                            <div key={detailIndex}>
                                                                {detail.type === 'text' ? (
                                                                    <div className="text-sm font-sans leading-relaxed break-words whitespace-pre-wrap">
                                                                        {detail.text}
                                                                    </div>
                                                                ) : (
                                                                    '<redacted>'
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : part.reasoning ? (
                                                    <div className="text-sm font-sans leading-relaxed break-words whitespace-pre-wrap">
                                                        {part.reasoning}
                                                    </div>
                                                ) : (
                                                    <div className="text-neutral-500 italic">
                                                        No reasoning details available
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                );
            }
            case 'tool-invocation':
                return (
                    <ToolInvocationListView
                        key={`${messageIndex}-${partIndex}-tool`}
                        toolInvocations={[part.toolInvocation]}
                        message={message}
                    />
                );
            default:
                return null;
        }
    };

    // Add near other state declarations in HomeContent
    interface ReasoningTiming {
        startTime: number;
        endTime?: number;
    }

    const [reasoningTimings, setReasoningTimings] = useState<Record<string, ReasoningTiming>>({});

    // Add state for tracking live elapsed time
    const [liveElapsedTimes, setLiveElapsedTimes] = useState<Record<string, number>>({});

    // Update live elapsed time for active reasoning sections
    useEffect(() => {
        const activeReasoningSections = Object.entries(reasoningTimings).filter(([_, timing]) => !timing.endTime);

        if (activeReasoningSections.length === 0) return;

        const interval = setInterval(() => {
            const now = Date.now();
            const updatedTimes: Record<string, number> = {};

            activeReasoningSections.forEach(([key, timing]) => {
                updatedTimes[key] = (now - timing.startTime) / 1000;
            });

            setLiveElapsedTimes((prev) => ({
                ...prev,
                ...updatedTimes,
            }));
        }, 100);

        return () => clearInterval(interval);
    }, [reasoningTimings]);

    useEffect(() => {
        messages.forEach((message, messageIndex) => {
            message.parts?.forEach((part, partIndex) => {
                if (part.type === 'reasoning') {
                    const sectionKey = `${messageIndex}-${partIndex}`;
                    const isComplete = message.parts[partIndex + 1]?.type === 'text';

                    if (!reasoningTimings[sectionKey]) {
                        setReasoningTimings((prev) => ({
                            ...prev,
                            [sectionKey]: { startTime: Date.now() },
                        }));
                    } else if (isComplete && !reasoningTimings[sectionKey].endTime) {
                        setReasoningTimings((prev) => ({
                            ...prev,
                            [sectionKey]: {
                                ...prev[sectionKey],
                                endTime: Date.now(),
                            },
                        }));
                    }
                }
            });
        });
    }, [messages, reasoningTimings]);

    const WidgetSection = memo(() => {
        const [currentTime, setCurrentTime] = useState(new Date());
        const timerRef = useRef<NodeJS.Timeout>();

        useEffect(() => {
            // Sync with the nearest second
            const now = new Date();
            const delay = 1000 - now.getMilliseconds();

            // Initial sync
            const timeout = setTimeout(() => {
                setCurrentTime(new Date());

                // Then start the interval
                timerRef.current = setInterval(() => {
                    setCurrentTime(new Date());
                }, 1000);
            }, delay);

            return () => {
                clearTimeout(timeout);
                if (timerRef.current) {
                    clearInterval(timerRef.current);
                }
            };
        }, []);

        // Get user's timezone
        const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Format date and time with timezone
        const dateFormatter = new Intl.DateTimeFormat('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            timeZone: timezone,
        });

        const timeFormatter = new Intl.DateTimeFormat('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            timeZone: timezone,
        });

        const formattedDate = dateFormatter.format(currentTime);
        const formattedTime = timeFormatter.format(currentTime);

        const handleDateTimeClick = useCallback(() => {
            if (status !== 'ready') return;

            append({
                content: `What's the current date and time?`,
                role: 'user',
            });

            lastSubmittedQueryRef.current = `What's the current date and time?`;
            setHasSubmitted(true);
        }, []);

        return (
            <div className="mt-8 w-full">
                <div className="flex flex-wrap gap-3 justify-center">
                    {/* Time Widget */}
                    <Button
                        variant="outline"
                        className="group flex items-center gap-2 px-4 py-2 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all h-auto"
                        onClick={handleDateTimeClick}
                    >
                        <Clock className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">
                            {formattedTime}
                        </span>
                    </Button>

                    {/* Date Widget */}
                    <Button
                        variant="outline"
                        className="group flex items-center gap-2 px-4 py-2 rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-all h-auto"
                        onClick={handleDateTimeClick}
                    >
                        <Calendar className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
                        <span className="text-sm text-neutral-700 dark:text-neutral-300 font-medium">
                            {formattedDate}
                        </span>
                    </Button>
                </div>
            </div>
        );
    });

    WidgetSection.displayName = 'WidgetSection';

    return (
        <div className="flex flex-col !font-sans items-center min-h-screen bg-background text-foreground transition-all duration-500">
            <Navbar />

            <div
                className={`w-full p-2 sm:p-4 ${
                    status === 'ready' && messages.length === 0
                        ? 'min-h-screen flex flex-col items-center justify-center' // Center everything when no messages
                        : 'mt-20 sm:mt-16' // Add top margin when showing messages
                }`}
            >
                <div
                    className={`w-full max-w-[90%] !font-sans sm:max-w-2xl space-y-6 p-0 mx-auto transition-all duration-300`}
                >
                    {status === 'ready' && messages.length === 0 && (
                        <div className="text-center !font-sans">
                            <h1 className="text-2xl sm:text-4xl mb-6 text-neutral-800 dark:text-neutral-100 font-syne">
                                What do you want to explore?
                            </h1>
                        </div>
                    )}
                    <AnimatePresence>
                        {messages.length === 0 && (
                            <motion.div
                                initial={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 20 }}
                                transition={{ duration: 0.5 }}
                                className="!mt-4"
                            >
                                <FormComponent
                                    input={input}
                                    setInput={setInput}
                                    attachments={attachments}
                                    setAttachments={setAttachments}
                                    handleSubmit={handleSubmit}
                                    fileInputRef={fileInputRef}
                                    inputRef={inputRef}
                                    stop={stop}
                                    messages={messages as any}
                                    append={append}
                                    selectedModel={selectedModel}
                                    setSelectedModel={handleModelChange}
                                    resetSuggestedQuestions={resetSuggestedQuestions}
                                    lastSubmittedQueryRef={lastSubmittedQueryRef}
                                    selectedGroup={selectedGroup}
                                    setSelectedGroup={setSelectedGroup}
                                    showExperimentalModels={true}
                                    status={status}
                                    setHasSubmitted={setHasSubmitted}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Add the widget section below form when no messages */}
                    {messages.length === 0 && (
                        <div>
                            <WidgetSection />
                        </div>
                    )}

                    <div className="space-y-4 sm:space-y-6 mb-32">
                        {memoizedMessages.map((message, index) => (
                            <div
                                key={index}
                                className={`${
                                    // Add border only if this is an assistant message AND there's a next message
                                    message.role === 'assistant' && index < memoizedMessages.length - 1
                                        ? '!mb-12 border-b border-neutral-200 dark:border-neutral-800'
                                        : ''
                                }`.trim()}
                            >
                                {message.role === 'user' && (
                                    <motion.div
                                        initial={{ opacity: 0, y: 20 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.5 }}
                                        className="mb-4 px-0"
                                    >
                                        <div className="flex-grow min-w-0">
                                            {isEditingMessage && editingMessageIndex === index ? (
                                                <form onSubmit={handleMessageUpdate} className="w-full">
                                                    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800">
                                                        <div className="flex items-center justify-between p-4 border-b border-neutral-200 dark:border-neutral-800">
                                                            <span className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                                                                Edit Query
                                                            </span>
                                                            <div className="bg-neutral-100 dark:bg-neutral-800 rounded-[9px] border border-neutral-200 dark:border-neutral-700 flex items-center">
                                                                <Button
                                                                    type="button"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => {
                                                                        setIsEditingMessage(false);
                                                                        setEditingMessageIndex(-1);
                                                                        setInput('');
                                                                    }}
                                                                    className="h-7 w-7 !rounded-l-lg !rounded-r-none text-neutral-500 dark:text-neutral-400 hover:text-primary"
                                                                    disabled={
                                                                        status === 'submitted' || status === 'streaming'
                                                                    }
                                                                >
                                                                    <X className="h-4 w-4" />
                                                                </Button>
                                                                <Separator
                                                                    orientation="vertical"
                                                                    className="h-7 bg-neutral-200 dark:bg-neutral-700"
                                                                />
                                                                <Button
                                                                    type="submit"
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-7 w-7 !rounded-r-lg !rounded-l-none text-neutral-500 dark:text-neutral-400 hover:text-primary"
                                                                    disabled={
                                                                        status === 'submitted' || status === 'streaming'
                                                                    }
                                                                >
                                                                    <ArrowRight className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        <div className="p-4">
                                                            <textarea
                                                                value={input}
                                                                onChange={(e) => setInput(e.target.value)}
                                                                rows={3}
                                                                className="w-full resize-none rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3 text-base text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
                                                                placeholder="Edit your message..."
                                                            />
                                                        </div>
                                                    </div>
                                                </form>
                                            ) : (
                                                <div className="group relative">
                                                    <div className="relative">
                                                        <p className="text-xl font-medium font-sans break-words text-neutral-900 dark:text-neutral-100 pr-10 sm:pr-12">
                                                            {message.content}
                                                        </p>
                                                        {!isEditingMessage && index === lastUserMessageIndex && (
                                                            <div className="absolute -right-2 top-0 opacity-0 group-hover:opacity-100 transition-opacity bg-transparent rounded-[9px] border border-neutral-200 dark:border-neutral-700 flex items-center">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => handleMessageEdit(index)}
                                                                    className="h-7 w-7 !rounded-l-lg !rounded-r-none text-neutral-500 dark:text-neutral-400 hover:text-primary"
                                                                    disabled={
                                                                        status === 'submitted' || status === 'streaming'
                                                                    }
                                                                >
                                                                    <svg
                                                                        width="15"
                                                                        height="15"
                                                                        viewBox="0 0 15 15"
                                                                        fill="none"
                                                                        xmlns="http://www.w3.org/2000/svg"
                                                                        className="h-4 w-4"
                                                                    >
                                                                        <path
                                                                            d="M12.1464 1.14645C12.3417 0.951184 12.6583 0.951184 12.8535 1.14645L14.8535 3.14645C15.0488 3.34171 15.0488 3.65829 14.8535 3.85355L10.9109 7.79618C10.8349 7.87218 10.7471 7.93543 10.651 7.9835L6.72359 9.94721C6.53109 10.0435 6.29861 10.0057 6.14643 9.85355C5.99425 9.70137 5.95652 9.46889 6.05277 9.27639L8.01648 5.34897C8.06455 5.25283 8.1278 5.16507 8.2038 5.08907L12.1464 1.14645ZM12.5 2.20711L8.91091 5.79618L7.87266 7.87267L9.94915 6.83442L13.5382 3.24535L12.5 2.20711ZM8.99997 1.49997C9.27611 1.49997 9.49997 1.72383 9.49997 1.99997C9.49997 2.27611 9.27611 2.49997 8.99997 2.49997H4.49997C3.67154 2.49997 2.99997 3.17154 2.99997 3.99997V11C2.99997 11.8284 3.67154 12.5 4.49997 12.5H11.5C12.3284 12.5 13 11.8284 13 11V6.49997C13 6.22383 13.2238 5.99997 13.5 5.99997C13.7761 5.99997 14 6.22383 14 6.49997V11C14 12.3807 12.8807 13.5 11.5 13.5H4.49997C3.11926 13.5 1.99997 12.3807 1.99997 11V3.99997C1.99997 2.61926 3.11926 1.49997 4.49997 1.49997H8.99997Z"
                                                                            fill="currentColor"
                                                                            fillRule="evenodd"
                                                                            clipRule="evenodd"
                                                                        />
                                                                    </svg>
                                                                </Button>
                                                                <Separator orientation="vertical" className="h-7" />
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    onClick={() => {
                                                                        navigator.clipboard.writeText(message.content);
                                                                        toast.success('Copied to clipboard');
                                                                    }}
                                                                    className="h-7 w-7 !rounded-r-lg !rounded-l-none text-neutral-500 dark:text-neutral-400 hover:text-primary"
                                                                >
                                                                    <Copy className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {message.experimental_attachments && (
                                                        <div className="flex flex-row gap-2 mt-3">
                                                            {message.experimental_attachments.map(
                                                                (attachment, attachmentIndex) => (
                                                                    <div key={attachmentIndex}>
                                                                        {attachment.contentType!.startsWith(
                                                                            'image/',
                                                                        ) && (
                                                                            <img
                                                                                src={attachment.url}
                                                                                alt={
                                                                                    attachment.name ||
                                                                                    `Attachment ${attachmentIndex + 1}`
                                                                                }
                                                                                className="max-w-full h-32 sm:h-48 object-cover rounded-lg border border-neutral-200 dark:border-neutral-800"
                                                                            />
                                                                        )}
                                                                    </div>
                                                                ),
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </motion.div>
                                )}

                                {message.role === 'assistant' && (
                                    <>
                                        {message.parts?.map((part, partIndex) =>
                                            renderPart(
                                                part as MessagePart,
                                                index,
                                                partIndex,
                                                message.parts as MessagePart[],
                                                message,
                                            ),
                                        )}

                                        {/* Add suggested questions if this is the last message and it's from the assistant */}
                                        {index === memoizedMessages.length - 1 && suggestedQuestions.length > 0 && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 20 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: 20 }}
                                                transition={{ duration: 0.5 }}
                                                className="w-full max-w-xl sm:max-w-2xl mt-6"
                                            >
                                                <div className="flex items-center gap-2 mb-4">
                                                    <AlignLeft className="w-5 h-5 text-primary" />
                                                    <h2 className="font-semibold text-base text-neutral-800 dark:text-neutral-200">
                                                        Suggested questions
                                                    </h2>
                                                </div>
                                                <div className="space-y-2 flex flex-col">
                                                    {suggestedQuestions.map((question, index) => (
                                                        <Button
                                                            key={index}
                                                            variant="ghost"
                                                            className="w-fit font-medium rounded-2xl p-1 justify-start text-left h-auto py-2 px-4 bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 hover:bg-neutral-200 dark:hover:bg-neutral-700 whitespace-normal"
                                                            onClick={() => handleSuggestedQuestionClick(question)}
                                                        >
                                                            {question}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </motion.div>
                                        )}
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                    <div ref={bottomRef} />
                </div>

                <AnimatePresence>
                    {messages.length > 0 || hasSubmitted ? (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 20 }}
                            transition={{ duration: 0.5 }}
                            className="fixed bottom-4 left-0 right-0 w-full max-w-[90%] sm:max-w-2xl mx-auto"
                        >
                            <FormComponent
                                input={input}
                                setInput={setInput}
                                attachments={attachments}
                                setAttachments={setAttachments}
                                handleSubmit={handleSubmit}
                                fileInputRef={fileInputRef}
                                inputRef={inputRef}
                                stop={stop}
                                messages={messages as any}
                                append={append}
                                selectedModel={selectedModel}
                                setSelectedModel={handleModelChange}
                                resetSuggestedQuestions={resetSuggestedQuestions}
                                lastSubmittedQueryRef={lastSubmittedQueryRef}
                                selectedGroup={selectedGroup}
                                setSelectedGroup={setSelectedGroup}
                                showExperimentalModels={false}
                                status={status}
                                setHasSubmitted={setHasSubmitted}
                            />
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        </div>
    );
};

const LoadingFallback = () => (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-neutral-50 to-neutral-100 dark:from-neutral-950 dark:to-neutral-900">
        <div className="flex flex-col items-center gap-6 p-8">
            <div className="relative w-12 h-12">
                <div className="absolute inset-0 rounded-full border-4 border-neutral-200 dark:border-neutral-800" />
                <div className="absolute inset-0 rounded-full border-4 border-t-primary animate-spin" />
            </div>

            <p className="text-sm text-neutral-600 dark:text-neutral-400 animate-pulse">Loading...</p>
        </div>
    </div>
);

const ToolInvocationListView = memo(
    ({ toolInvocations, message }: { toolInvocations: ToolInvocation[]; message: any }) => {
        const renderToolInvocation = useCallback(
            (toolInvocation: ToolInvocation, index: number) => {
                const args = JSON.parse(JSON.stringify(toolInvocation.args));
                const result = 'result' in toolInvocation ? JSON.parse(JSON.stringify(toolInvocation.result)) : null;

                if (toolInvocation.toolName === 'text_search') {
                    if (!result) {
                        return (
                            <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-2">
                                    <MapPin className="h-5 w-5 text-neutral-700 dark:text-neutral-300 animate-pulse" />
                                    <span className="text-neutral-700 dark:text-neutral-300 text-lg">
                                        Searching places...
                                    </span>
                                </div>
                                <motion.div className="flex space-x-1">
                                    {[0, 1, 2].map((index) => (
                                        <motion.div
                                            key={index}
                                            className="w-2 h-2 bg-neutral-400 dark:bg-neutral-600 rounded-full"
                                            initial={{ opacity: 0.3 }}
                                            animate={{ opacity: 1 }}
                                            transition={{
                                                repeat: Infinity,
                                                duration: 0.8,
                                                delay: index * 0.2,
                                                repeatType: 'reverse',
                                            }}
                                        />
                                    ))}
                                </motion.div>
                            </div>
                        );
                    }

                    const centerLocation = result.results[0]?.geometry?.location;
                    return (
                        <MapContainer
                            title="Search Results"
                            center={centerLocation}
                            places={result.results.map((place: any) => ({
                                name: place.name,
                                location: place.geometry.location,
                                vicinity: place.formatted_address,
                            }))}
                        />
                    );
                }

                if (toolInvocation.toolName === 'code_interpreter') {
                    return (
                        <div className="space-y-6">
                            <CollapsibleSection
                                code={args.code}
                                output={result?.message}
                                language="python"
                                title={args.title}
                                icon={args.icon || 'default'}
                                status={result ? 'completed' : 'running'}
                            />

                            {result?.chart && (
                                <div className="pt-1">
                                    <InteractiveChart chart={result.chart} />
                                </div>
                            )}
                        </div>
                    );
                }

                console.log(
                    '######################### toolInvocation #################################',
                    toolInvocation,
                );
                if (toolInvocation.toolName === 'reason_search') {
                    console.log('######################### reason_search #################################', message);
                    const updates = message?.annotations
                        ?.filter((a: any) => a.type === 'research_update')
                        .map((a: any) => a.data);
                    return <ReasonSearch updates={updates || []} />;
                }

                if (toolInvocation.toolName === 'web_search') {
                    return (
                        <div className="mt-4">
                            <MultiSearch
                                result={result}
                                args={args}
                                annotations={
                                    message?.annotations?.filter((a: any) => a.type === 'query_completion') || []
                                }
                            />
                        </div>
                    );
                }

                if (toolInvocation.toolName === 'datetime') {
                    if (!result) {
                        return (
                            <div className="flex items-center gap-3 py-4 px-2">
                                <div className="h-5 w-5 relative">
                                    <div className="absolute inset-0 rounded-full border-2 border-neutral-300 dark:border-neutral-700 border-t-blue-500 dark:border-t-blue-400 animate-spin" />
                                </div>
                                <span className="text-neutral-700 dark:text-neutral-300 text-sm font-medium">
                                    Fetching current time...
                                </span>
                            </div>
                        );
                    }

                    // Live Clock component that updates every second
                    const LiveClock = memo(() => {
                        const [time, setTime] = useState(() => new Date());
                        const timerRef = useRef<NodeJS.Timeout>();

                        useEffect(() => {
                            // Sync with the nearest second
                            const now = new Date();
                            const delay = 1000 - now.getMilliseconds();

                            // Initial sync
                            const timeout = setTimeout(() => {
                                setTime(new Date());

                                // Then start the interval
                                timerRef.current = setInterval(() => {
                                    setTime(new Date());
                                }, 1000);
                            }, delay);

                            return () => {
                                clearTimeout(timeout);
                                if (timerRef.current) {
                                    clearInterval(timerRef.current);
                                }
                            };
                        }, []);

                        // Format the time according to the specified timezone
                        const timezone = result.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone;
                        const formatter = new Intl.DateTimeFormat('en-US', {
                            hour: 'numeric',
                            minute: 'numeric',
                            second: 'numeric',
                            hour12: true,
                            timeZone: timezone,
                        });

                        const formattedParts = formatter.formatToParts(time);
                        const timeParts = {
                            hour: formattedParts.find((part) => part.type === 'hour')?.value || '12',
                            minute: formattedParts.find((part) => part.type === 'minute')?.value || '00',
                            second: formattedParts.find((part) => part.type === 'second')?.value || '00',
                            dayPeriod: formattedParts.find((part) => part.type === 'dayPeriod')?.value || 'AM',
                        };

                        return (
                            <div className="mt-3">
                                <div className="flex items-baseline">
                                    <div className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tighter tabular-nums text-neutral-900 dark:text-white">
                                        {timeParts.hour.padStart(2, '0')}
                                    </div>
                                    <div className="mx-1 sm:mx-2 text-4xl sm:text-5xl md:text-6xl font-light text-neutral-400 dark:text-neutral-500">
                                        :
                                    </div>
                                    <div className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tighter tabular-nums text-neutral-900 dark:text-white">
                                        {timeParts.minute.padStart(2, '0')}
                                    </div>
                                    <div className="mx-1 sm:mx-2 text-4xl sm:text-5xl md:text-6xl font-light text-neutral-400 dark:text-neutral-500">
                                        :
                                    </div>
                                    <div className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tighter tabular-nums text-neutral-900 dark:text-white">
                                        {timeParts.second.padStart(2, '0')}
                                    </div>
                                    <div className="ml-2 sm:ml-4 text-xl sm:text-2xl font-light self-center text-neutral-400 dark:text-neutral-500">
                                        {timeParts.dayPeriod}
                                    </div>
                                </div>
                            </div>
                        );
                    });

                    LiveClock.displayName = 'LiveClock';

                    return (
                        <div className="w-full my-6">
                            <div className="bg-white dark:bg-neutral-950 rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
                                <div className="p-5 sm:p-6 md:p-8">
                                    <div className="flex flex-col gap-6 sm:gap-8 md:gap-10">
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <h3 className="text-xs sm:text-sm font-medium text-neutral-500 dark:text-neutral-400 tracking-wider uppercase">
                                                    Current Time
                                                </h3>
                                                <div className="bg-neutral-100 dark:bg-neutral-800 rounded-md px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 font-medium flex items-center gap-1.5">
                                                    <Clock className="h-3 w-3 text-blue-500" />
                                                    {result.timezone ||
                                                        new Intl.DateTimeFormat().resolvedOptions().timeZone}
                                                </div>
                                            </div>
                                            <LiveClock />
                                        </div>

                                        <div>
                                            <h3 className="text-xs sm:text-sm font-medium text-neutral-500 dark:text-neutral-400 tracking-wider uppercase mb-2">
                                                Today&apos;s Date
                                            </h3>
                                            <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 sm:gap-4 md:gap-6">
                                                <h2 className="text-3xl sm:text-4xl md:text-5xl font-light text-neutral-900 dark:text-white">
                                                    {result.formatted.dateShort}
                                                </h2>
                                                <p className="text-sm sm:text-base text-neutral-500 dark:text-neutral-500">
                                                    {result.formatted.date}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                }

                if (toolInvocation.toolName === 'memory_manager') {
                    if (!result) {
                        return <SearchLoadingState icon={Memory} text="Managing memories..." color="violet" />;
                    }
                    return <MemoryManager result={result} />;
                }

                return null;
            },
            [message],
        );

        return (
            <>
                {toolInvocations.map((toolInvocation: ToolInvocation, toolIndex: number) => (
                    <div key={`tool-${toolIndex}`}>{renderToolInvocation(toolInvocation, toolIndex)}</div>
                ))}
            </>
        );
    },
    (prevProps, nextProps) => {
        return prevProps.toolInvocations === nextProps.toolInvocations && prevProps.message === nextProps.message;
    },
);

ToolInvocationListView.displayName = 'ToolInvocationListView';

const Home = () => {
    return (
        <Suspense fallback={<LoadingFallback />}>
            <HomeContent />
            <InstallPrompt />
        </Suspense>
    );
};

export default Home;

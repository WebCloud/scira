// /app/api/chat/route.ts
import { getGroupConfig } from '@/app/actions';
import { serverEnv } from '@/env/server';
import { xai } from '@ai-sdk/xai';
import CodeInterpreter from '@e2b/code-interpreter';
import FirecrawlApp from '@mendable/firecrawl-js';
import { tavily } from '@tavily/core';
import {
    convertToCoreMessages,
    smoothStream,
    streamText,
    tool,
    createDataStreamResponse,
    wrapLanguageModel,
    extractReasoningMiddleware,
    customProvider,
    generateObject,
    NoSuchToolError,
} from 'ai';
import { z } from 'zod';
import { geolocation } from '@vercel/functions';
import MemoryClient from 'mem0ai';
import { ollama } from 'ollama-ai-provider';
import { analyzeInsights, TraceTopic } from '@/lib/insights';

const scira = customProvider({
    languageModels: {
        'scira-default': ollama('qwen2.5-coder:14b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-vision': ollama('llama3.2-vision', { structuredOutputs: true, simulateStreaming: true }),
        'scira-llama': ollama('llama3.1:8b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-sonnet': ollama('mixtral:8x7b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-r1': wrapLanguageModel({
            model: ollama('deepseek-r1:14b', { structuredOutputs: true, simulateStreaming: true }),
            middleware: extractReasoningMiddleware({ tagName: 'think' }),
        }),
    },
});

// Allow streaming responses up to 600 seconds
export const maxDuration = 600;

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

interface MapboxFeature {
    id: string;
    name: string;
    formatted_address: string;
    geometry: {
        type: string;
        coordinates: number[];
    };
    feature_type: string;
    context: string;
    coordinates: number[];
    bbox: number[];
    source: string;
}

interface GoogleResult {
    place_id: string;
    formatted_address: string;
    geometry: {
        location: {
            lat: number;
            lng: number;
        };
        viewport: {
            northeast: {
                lat: number;
                lng: number;
            };
            southwest: {
                lat: number;
                lng: number;
            };
        };
    };
    types: string[];
    address_components: Array<{
        long_name: string;
        short_name: string;
        types: string[];
    }>;
}

interface VideoDetails {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
    type?: string;
    provider_name?: string;
    provider_url?: string;
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

function sanitizeUrl(url: string): string {
    return url.replace(/\s+/g, '%20');
}

async function isValidImageUrl(url: string): Promise<boolean> {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
        });

        clearTimeout(timeout);

        return response.ok && (response.headers.get('content-type')?.startsWith('image/') ?? false);
    } catch {
        return false;
    }
}

const extractDomain = (url: string): string => {
    const urlPattern = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/i;
    return url.match(urlPattern)?.[1] || url;
};

const deduplicateByDomainAndUrl = <T extends { url: string }>(items: T[]): T[] => {
    const seenDomains = new Set<string>();
    const seenUrls = new Set<string>();

    return items.filter((item) => {
        const domain = extractDomain(item.url);
        const isNewUrl = !seenUrls.has(item.url);
        const isNewDomain = !seenDomains.has(domain);

        if (isNewUrl && isNewDomain) {
            seenUrls.add(item.url);
            seenDomains.add(domain);
            return true;
        }
        return false;
    });
};

// Modify the POST function to use the new handler
export async function POST(req: Request) {
    const { messages, model, group, user_id, insights, userInteractions } = await req.json();
    console.log('insights on the backend', insights);
    const { tools: activeTools, systemPrompt, toolInstructions, responseGuidelines } = await getGroupConfig('extreme');
    const geo = geolocation(req);

    console.log('Running with model: ', model.trim());
    console.log('Group: ', group);

    if (true) {
        console.log('Running inside part 1');
        return createDataStreamResponse({
            execute: async (dataStream) => {
                const toolsResult = streamText({
                    model: scira.languageModel(model),
                    messages: convertToCoreMessages(messages),
                    temperature: 0,
                    experimental_activeTools: [...activeTools],
                    system: toolInstructions,
                    toolChoice: 'auto',
                    tools: {
                        text_translate: tool({
                            description: 'Translate text from one language to another.',
                            parameters: z.object({
                                text: z.string().describe('The text to translate.'),
                                to: z.string().describe("The language to translate to (e.g., 'fr' for French)."),
                            }),
                            execute: async ({ text, to }: { text: string; to: string }) => {
                                const { object: translation } = await generateObject({
                                    model: scira.languageModel(model),
                                    system: `You are a helpful assistant that translates text from one language to another.`,
                                    prompt: `Translate the following text to ${to} language: ${text}`,
                                    schema: z.object({
                                        translatedText: z.string(),
                                        detectedLanguage: z.string(),
                                    }),
                                });
                                console.log(translation);
                                return {
                                    translatedText: translation.translatedText,
                                    detectedLanguage: translation.detectedLanguage,
                                };
                            },
                        }),
                        web_search: tool({
                            description:
                                'Search the web for information with multiple queries, max results and search depth.',
                            parameters: z.object({
                                queries: z.array(z.string().describe('Array of search queries to look up on the web.')),
                                maxResults: z.array(
                                    z
                                        .number()
                                        .describe('Array of maximum number of results to return per query.')
                                        .default(10),
                                ),
                                topics: z.array(
                                    z
                                        .enum(['general', 'news'])
                                        .describe('Array of topic types to search for.')
                                        .default('general'),
                                ),
                                searchDepth: z.array(
                                    z
                                        .enum(['basic', 'advanced'])
                                        .describe('Array of search depths to use.')
                                        .default('basic'),
                                ),
                                exclude_domains: z
                                    .array(z.string())
                                    .describe('A list of domains to exclude from all search results.')
                                    .default([]),
                            }),
                            execute: async ({
                                queries,
                                maxResults,
                                topics,
                                searchDepth,
                                exclude_domains,
                            }: {
                                queries: string[];
                                maxResults: number[];
                                topics: ('general' | 'news')[];
                                searchDepth: ('basic' | 'advanced')[];
                                exclude_domains?: string[];
                            }) => {
                                const apiKey = serverEnv.TAVILY_API_KEY;
                                const tvly = tavily({ apiKey });
                                const includeImageDescriptions = true;

                                console.log('Queries:', queries);
                                console.log('Max Results:', maxResults);
                                console.log('Topics:', topics);
                                console.log('Search Depths:', searchDepth);
                                console.log('Exclude Domains:', exclude_domains);

                                // Execute searches in parallel
                                const searchPromises = queries.map(async (query, index) => {
                                    const data = await tvly.search(query, {
                                        topic: topics[index] || topics[0] || 'general',
                                        days: topics[index] === 'news' ? 7 : undefined,
                                        maxResults: maxResults[index] || maxResults[0] || 10,
                                        searchDepth: searchDepth[index] || searchDepth[0] || 'basic',
                                        includeAnswer: true,
                                        includeImages: true,
                                        includeImageDescriptions: includeImageDescriptions,
                                        excludeDomains: exclude_domains,
                                    });

                                    // Add annotation for query completion
                                    dataStream.writeMessageAnnotation({
                                        type: 'query_completion',
                                        data: {
                                            query,
                                            index,
                                            total: queries.length,
                                            status: 'completed',
                                            resultsCount: data.results.length,
                                            imagesCount: data.images.length,
                                        },
                                    });

                                    return {
                                        query,
                                        results: deduplicateByDomainAndUrl(data.results).map((obj: any) => ({
                                            url: obj.url,
                                            title: obj.title,
                                            content: obj.content,
                                            raw_content: obj.raw_content,
                                            published_date: topics[index] === 'news' ? obj.published_date : undefined,
                                        })),
                                        images: includeImageDescriptions
                                            ? await Promise.all(
                                                  deduplicateByDomainAndUrl(data.images).map(
                                                      async ({
                                                          url,
                                                          description,
                                                      }: {
                                                          url: string;
                                                          description?: string;
                                                      }) => {
                                                          const sanitizedUrl = sanitizeUrl(url);
                                                          const isValid = await isValidImageUrl(sanitizedUrl);
                                                          return isValid
                                                              ? {
                                                                    url: sanitizedUrl,
                                                                    description: description ?? '',
                                                                }
                                                              : null;
                                                      },
                                                  ),
                                              ).then((results) =>
                                                  results.filter(
                                                      (image): image is { url: string; description: string } =>
                                                          image !== null &&
                                                          typeof image === 'object' &&
                                                          typeof image.description === 'string' &&
                                                          image.description !== '',
                                                  ),
                                              )
                                            : await Promise.all(
                                                  deduplicateByDomainAndUrl(data.images).map(
                                                      async ({ url }: { url: string }) => {
                                                          const sanitizedUrl = sanitizeUrl(url);
                                                          return (await isValidImageUrl(sanitizedUrl))
                                                              ? sanitizedUrl
                                                              : null;
                                                      },
                                                  ),
                                              ).then((results) => results.filter((url) => url !== null) as string[]),
                                    };
                                });

                                const searchResults = await Promise.all(searchPromises);

                                return {
                                    searches: searchResults,
                                };
                            },
                        }),
                        retrieve: tool({
                            description: 'Retrieve the information from a URL using Firecrawl.',
                            parameters: z.object({
                                url: z.string().describe('The URL to retrieve the information from.'),
                            }),
                            execute: async ({ url }: { url: string }) => {
                                const app = new FirecrawlApp({
                                    apiKey: serverEnv.FIRECRAWL_API_KEY,
                                });
                                try {
                                    const content = await app.scrapeUrl(url);
                                    if (!content.success || !content.metadata) {
                                        return {
                                            results: [
                                                {
                                                    error: content.error,
                                                },
                                            ],
                                        };
                                    }

                                    // Define schema for extracting missing content
                                    const schema = z.object({
                                        title: z.string(),
                                        content: z.string(),
                                        description: z.string(),
                                    });

                                    let title = content.metadata.title;
                                    let description = content.metadata.description;
                                    let extractedContent = content.markdown;

                                    // If any content is missing, use extract to get it
                                    if (!title || !description || !extractedContent) {
                                        const extractResult = await app.extract([url], {
                                            prompt: 'Extract the page title, main content, and a brief description.',
                                            schema: schema,
                                        });

                                        if (extractResult.success && extractResult.data) {
                                            title = title || extractResult.data.title;
                                            description = description || extractResult.data.description;
                                            extractedContent = extractedContent || extractResult.data.content;
                                        }
                                    }

                                    return {
                                        results: [
                                            {
                                                title: title || 'Untitled',
                                                content: extractedContent || '',
                                                url: content.metadata.sourceURL,
                                                description: description || '',
                                                language: content.metadata.language,
                                            },
                                        ],
                                    };
                                } catch (error) {
                                    console.error('Firecrawl API error:', error);
                                    return { error: 'Failed to retrieve content' };
                                }
                            },
                        }),
                        code_interpreter: tool({
                            description: 'Write and execute Python code.',
                            parameters: z.object({
                                title: z.string().describe('The title of the code snippet.'),
                                code: z
                                    .string()
                                    .describe(
                                        'The Python code to execute. put the variables in the end of the code to print them. do not use the print function.',
                                    ),
                                icon: z
                                    .enum(['stock', 'date', 'calculation', 'default'])
                                    .describe('The icon to display for the code snippet.'),
                            }),
                            execute: async ({ code, title, icon }: { code: string; title: string; icon: string }) => {
                                console.log('Code:', code);
                                console.log('Title:', title);
                                console.log('Icon:', icon);

                                const sandbox = await CodeInterpreter.create(serverEnv.SANDBOX_TEMPLATE_ID!);
                                const execution = await sandbox.runCode(code);
                                let message = '';

                                if (execution.results.length > 0) {
                                    for (const result of execution.results) {
                                        if (result.isMainResult) {
                                            message += `${result.text}\n`;
                                        } else {
                                            message += `${result.text}\n`;
                                        }
                                    }
                                }

                                if (execution.logs.stdout.length > 0 || execution.logs.stderr.length > 0) {
                                    if (execution.logs.stdout.length > 0) {
                                        message += `${execution.logs.stdout.join('\n')}\n`;
                                    }
                                    if (execution.logs.stderr.length > 0) {
                                        message += `${execution.logs.stderr.join('\n')}\n`;
                                    }
                                }

                                if (execution.error) {
                                    message += `Error: ${execution.error}\n`;
                                    console.log('Error: ', execution.error);
                                }

                                console.log(execution.results);
                                if (execution.results[0].chart) {
                                    execution.results[0].chart.elements.map((element: any) => {
                                        console.log(element.points);
                                    });
                                }

                                return {
                                    message: message.trim(),
                                    chart: execution.results[0].chart ?? '',
                                };
                            },
                        }),
                        text_search: tool({
                            description: 'Perform a text-based search for places using Mapbox API.',
                            parameters: z.object({
                                query: z.string().describe("The search query (e.g., '123 main street')."),
                                location: z
                                    .string()
                                    .describe("The location to center the search (e.g., '42.3675294,-71.186966')."),
                                radius: z.number().describe('The radius of the search area in meters (max 50000).'),
                            }),
                            execute: async ({
                                query,
                                location,
                                radius,
                            }: {
                                query: string;
                                location?: string;
                                radius?: number;
                            }) => {
                                const mapboxToken = serverEnv.MAPBOX_ACCESS_TOKEN;

                                let proximity = '';
                                if (location) {
                                    const [lng, lat] = location.split(',').map(Number);
                                    proximity = `&proximity=${lng},${lat}`;
                                }

                                const response = await fetch(
                                    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
                                        query,
                                    )}.json?types=poi${proximity}&access_token=${mapboxToken}`,
                                );
                                const data = await response.json();

                                // If location and radius provided, filter results by distance
                                let results = data.features;
                                if (location && radius) {
                                    const [centerLng, centerLat] = location.split(',').map(Number);
                                    const radiusInDegrees = radius / 111320;
                                    results = results.filter((feature: any) => {
                                        const [placeLng, placeLat] = feature.center;
                                        const distance = Math.sqrt(
                                            Math.pow(placeLng - centerLng, 2) + Math.pow(placeLat - centerLat, 2),
                                        );
                                        return distance <= radiusInDegrees;
                                    });
                                }

                                return {
                                    results: results.map((feature: any) => ({
                                        name: feature.text,
                                        formatted_address: feature.place_name,
                                        geometry: {
                                            location: {
                                                lat: feature.center[1],
                                                lng: feature.center[0],
                                            },
                                        },
                                    })),
                                };
                            },
                        }),
                        datetime: tool({
                            description: "Get the current date and time in the user's timezone",
                            parameters: z.object({}),
                            execute: async () => {
                                try {
                                    // Get current date and time
                                    const now = new Date();

                                    // Use geolocation to determine timezone
                                    let userTimezone = 'UTC'; // Default to UTC

                                    if (geo && geo.latitude && geo.longitude) {
                                        try {
                                            // Get timezone from coordinates using Google Maps API
                                            const tzResponse = await fetch(
                                                `https://maps.googleapis.com/maps/api/timezone/json?location=${
                                                    geo.latitude
                                                },${geo.longitude}&timestamp=${Math.floor(now.getTime() / 1000)}&key=${
                                                    serverEnv.GOOGLE_MAPS_API_KEY
                                                }`,
                                            );

                                            if (tzResponse.ok) {
                                                const tzData = await tzResponse.json();
                                                if (tzData.status === 'OK' && tzData.timeZoneId) {
                                                    userTimezone = tzData.timeZoneId;
                                                    console.log(
                                                        `Timezone determined from coordinates: ${userTimezone}`,
                                                    );
                                                } else {
                                                    console.log(
                                                        `Failed to get timezone from coordinates: ${
                                                            tzData.status || 'Unknown error'
                                                        }`,
                                                    );
                                                }
                                            } else {
                                                console.log(
                                                    `Timezone API request failed with status: ${tzResponse.status}`,
                                                );
                                            }
                                        } catch (error) {
                                            console.error('Error fetching timezone from coordinates:', error);
                                        }
                                    } else {
                                        console.log('No geolocation data available, using UTC');
                                    }

                                    // Format date and time using the timezone
                                    return {
                                        timestamp: now.getTime(),
                                        iso: now.toISOString(),
                                        timezone: userTimezone,
                                        formatted: {
                                            date: new Intl.DateTimeFormat('en-US', {
                                                weekday: 'long',
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric',
                                                timeZone: userTimezone,
                                            }).format(now),
                                            time: new Intl.DateTimeFormat('en-US', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                                hour12: true,
                                                timeZone: userTimezone,
                                            }).format(now),
                                            dateShort: new Intl.DateTimeFormat('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                                timeZone: userTimezone,
                                            }).format(now),
                                            timeShort: new Intl.DateTimeFormat('en-US', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                hour12: true,
                                                timeZone: userTimezone,
                                            }).format(now),
                                        },
                                    };
                                } catch (error) {
                                    console.error('Datetime error:', error);
                                    throw error;
                                }
                            },
                        }),
                        reason_search: tool({
                            description: 'Perform a reasoned web search with multiple steps and sources.',
                            parameters: z.object({
                                topic: z.string().describe('The main topic or question to research'),
                                depth: z.enum(['basic', 'advanced']).describe('Search depth level').default('basic'),
                            }),
                            execute: async ({ topic, depth }: { topic: string; depth: 'basic' | 'advanced' }) => {
                                const apiKey = serverEnv.TAVILY_API_KEY;
                                const tvly = tavily({ apiKey });

                                // Send initial plan status update (without steps count and extra details)
                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: {
                                        id: 'research-plan-initial', // unique id for the initial state
                                        type: 'plan',
                                        status: 'running',
                                        title: 'Research Plan',
                                        message: 'Creating research plan...',
                                        timestamp: Date.now(),
                                        overwrite: true,
                                    },
                                });

                                // Now generate the research plan
                                const { object: researchPlan } = await generateObject({
                                    model: scira.languageModel('scira-default'),
                                    temperature: 0,
                                    schema: z.object({
                                        search_queries: z
                                            .array(
                                                z.object({
                                                    query: z.string(),
                                                    rationale: z.string(),
                                                    source: z.enum(['web', 'all']),
                                                    priority: z.number().min(1).max(5),
                                                }),
                                            )
                                            .max(12),
                                        required_analyses: z
                                            .array(
                                                z.object({
                                                    type: z.string(),
                                                    description: z.string(),
                                                    importance: z.number().min(1).max(5),
                                                }),
                                            )
                                            .max(8),
                                    }),
                                    prompt: `Create a focused research plan for the topic: "${topic}". 
                                        
                                        Today's date and day of the week: ${new Date().toLocaleDateString('en-US', {
                                            weekday: 'long',
                                            year: 'numeric',
                                            month: 'long',
                                            day: 'numeric',
                                        })}
                                
                                        Keep the plan concise but comprehensive, with:
                                        - 4-8 targeted search queries (each can use web as source. Focus on web.dev as main source whenever possible)
                                        - 2-4 key analyses to perform
                                        - Prioritize the most important aspects to investigate
                                        
                                        Available sources:
                                        - "web": General web search
                                        
                                        Do not use floating numbers, use whole numbers only in the priority field!!
                                        Do not keep the numbers too low or high, make them reasonable in between.
                                        Do not use 0 or 1 in the priority field, use numbers between 2 and 4.
                                        
                                        Consider related topics, but maintain focus on the core aspects.
                                        Here's the list of topics represent different aspects of a performance trace.

Core Web Vitals Context
Core Web Vitals are Google's metrics for measuring web page experience:

Loading (LCP): Largest Contentful Paint - measures loading performance (2.5s or less is good)
Interactivity (INP): Interaction to Next Paint - measures responsiveness (100ms or less is good)
Visual Stability (CLS): Cumulative Layout Shift - measures visual stability (0.1 or less is good)

Additional important metrics include:

TTFB (Time to First Byte)
FCP (First Contentful Paint)
TTI (Time to Interactive)
TBT (Total Blocking Time)
Resource optimization (JS, CSS, images, fonts)
Network performance (caching, compression)

                                        Ensure the total number of steps (searches + analyses) does not exceed 10.`,
                                });

                                // Generate IDs for all steps based on the plan
                                const generateStepIds = (plan: typeof researchPlan) => {
                                    // Generate an array of search steps.
                                    const searchSteps = plan.search_queries.flatMap((query, index) => {
                                        if (query.source === 'all') {
                                            return [{ id: `search-web-${index}`, type: 'web', query }];
                                        }
                                        const searchType = 'web';
                                        return [{ id: `search-${searchType}-${index}`, type: searchType, query }];
                                    });

                                    // Generate an array of analysis steps.
                                    const analysisSteps = plan.required_analyses.map((analysis, index) => ({
                                        id: `analysis-${index}`,
                                        type: 'analysis',
                                        analysis,
                                    }));

                                    return {
                                        planId: 'research-plan',
                                        searchSteps,
                                        analysisSteps,
                                    };
                                };

                                const stepIds = generateStepIds(researchPlan);
                                let completedSteps = 0;
                                const totalSteps = stepIds.searchSteps.length + stepIds.analysisSteps.length;

                                // Complete plan status
                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: {
                                        id: stepIds.planId,
                                        type: 'plan',
                                        status: 'completed',
                                        title: 'Research Plan',
                                        plan: researchPlan,
                                        totalSteps: totalSteps,
                                        message: 'Research plan created',
                                        timestamp: Date.now(),
                                        overwrite: true,
                                    },
                                });

                                // Execute searches
                                const searchResults = [];
                                let searchIndex = 0; // Add index tracker

                                for (const step of stepIds.searchSteps) {
                                    // Send running annotation for this search step
                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: step.id,
                                            type: step.type,
                                            status: 'running',
                                            title: `Searching the web for "${step.query.query}"`,
                                            query: step.query.query,
                                            message: `Searching ${step.query.source} sources...`,
                                            timestamp: Date.now(),
                                        },
                                    });

                                    if (step.type === 'web' || step.type === 'academic') {
                                        const webResults = await tvly.search(step.query.query, {
                                            searchDepth: depth,
                                            includeAnswer: true,
                                            includeDomains: [
                                                'https://web.dev',
                                                'https://www.chromium.org/',
                                                'https://developer.chrome.com',
                                                'https://developer.mozilla.org',
                                                'https://dev.to',
                                            ],
                                            maxResults: Math.min(6 - step.query.priority, 10),
                                        });

                                        searchResults.push({
                                            type: 'web',
                                            query: step.query,
                                            results: webResults.results.map((r) => ({
                                                source: 'web',
                                                title: r.title,
                                                url: r.url,
                                                content: r.content,
                                            })),
                                        });
                                        completedSteps++;
                                    }

                                    // Send completed annotation for the search step
                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: step.id,
                                            type: step.type,
                                            status: 'completed',
                                            title:
                                                step.type === 'web'
                                                    ? `Searched the web for "${step.query.query}"`
                                                    : step.type === 'academic'
                                                    ? `Searched academic papers for "${step.query.query}"`
                                                    : step.type === 'x'
                                                    ? `Searched X/Twitter for "${step.query.query}"`
                                                    : `Analysis of ${step.query.query} complete`,
                                            query: step.query.query,
                                            results: searchResults[searchResults.length - 1].results.map((r) => {
                                                return { ...r };
                                            }),
                                            message: `Found ${
                                                searchResults[searchResults.length - 1].results.length
                                            } results`,
                                            timestamp: Date.now(),
                                            overwrite: true,
                                        },
                                    });

                                    searchIndex++; // Increment index
                                }

                                // Perform analyses
                                let analysisIndex = 0; // Add index tracker

                                for (const step of stepIds.analysisSteps) {
                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: step.id,
                                            type: 'analysis',
                                            status: 'running',
                                            title: `Analyzing ${step.analysis.type}`,
                                            analysisType: step.analysis.type,
                                            message: `Analyzing ${step.analysis.type}...`,
                                            timestamp: Date.now(),
                                        },
                                    });

                                    const { object: analysisResult } = await generateObject({
                                        model: scira.languageModel('scira-default'),
                                        temperature: 0.5,
                                        schema: z.object({
                                            findings: z.array(
                                                z.object({
                                                    insight: z.string(),
                                                    evidence: z.array(z.string()),
                                                    confidence: z.number().min(0).max(1),
                                                }),
                                            ),
                                            implications: z.array(z.string()),
                                            limitations: z.array(z.string()),
                                        }),
                                        prompt: `Perform a ${step.analysis.type} analysis on the search results. ${
                                            step.analysis.description
                                        }
                                            Consider all sources and their reliability.
                                            Search results: ${JSON.stringify(searchResults)}
                                            IMPORTANT: ENSURE TO RETURN CONFIDENCE SCORES BETWEEN 0 AND 1.`,
                                    });

                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: step.id,
                                            type: 'analysis',
                                            status: 'completed',
                                            title: `Analysis of ${step.analysis.type} complete`,
                                            analysisType: step.analysis.type,
                                            findings: analysisResult.findings,
                                            message: `Analysis complete`,
                                            timestamp: Date.now(),
                                            overwrite: true,
                                        },
                                    });

                                    analysisIndex++; // Increment index
                                }

                                // After all analyses are complete, send running state for gap analysis
                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: {
                                        id: 'gap-analysis',
                                        type: 'analysis',
                                        status: 'running',
                                        title: 'Research Gaps and Limitations',
                                        analysisType: 'gaps',
                                        message: 'Analyzing research gaps and limitations...',
                                        timestamp: Date.now(),
                                    },
                                });

                                // After all analyses are complete, analyze limitations and gaps
                                const { object: gapAnalysis } = await generateObject({
                                    model: scira.languageModel('scira-default'),
                                    temperature: 0,
                                    schema: z.object({
                                        limitations: z.array(
                                            z.object({
                                                type: z.string(),
                                                description: z.string(),
                                                severity: z.number().min(2).max(10),
                                                potential_solutions: z.array(z.string()),
                                            }),
                                        ),
                                        knowledge_gaps: z.array(
                                            z.object({
                                                topic: z.string(),
                                                reason: z.string(),
                                                additional_queries: z.array(z.string()),
                                            }),
                                        ),
                                        recommended_followup: z.array(
                                            z.object({
                                                action: z.string(),
                                                rationale: z.string(),
                                                priority: z.number().min(2).max(10),
                                            }),
                                        ),
                                    }),
                                    prompt: `Analyze the research results and identify limitations, knowledge gaps, and recommended follow-up actions.
                                        Consider:
                                        - Quality and reliability of sources (prefer web.dev as main source whenever possible)
                                        - Missing alignment to main topic or data
                                        - Areas needing deeper investigation (focus on web performance and web vitals always)
                                        - Severity should be between 2 and 10
                                        - Knowledge gaps should be between 2 and 10
                                        - Do not keep the numbers too low or high, make them reasonable in between
                                        
                                        When suggesting additional_queries for knowledge gaps, keep in mind these will be used to search:
                                        - Web sources (prefer web.dev as main source whenever possible)
                                        
                                        Design your additional_queries to work well across these different source types.

                                        Here's the list of topics represent different aspects of a performance trace.

                                        Core Web Vitals Context
                                        Core Web Vitals are Google's metrics for measuring web page experience:

                                        Loading (LCP): Largest Contentful Paint - measures loading performance (2.5s or less is good)
                                        Interactivity (INP): Interaction to Next Paint - measures responsiveness (100ms or less is good)
                                        Visual Stability (CLS): Cumulative Layout Shift - measures visual stability (0.1 or less is good)

                                        Additional important metrics include:

                                        TTFB (Time to First Byte)
                                        FCP (First Contentful Paint)
                                        TTI (Time to Interactive)
                                        TBT (Total Blocking Time)
                                        Resource optimization (JS, CSS, images, fonts)
                                        Network performance (caching, compression)
                                        
                                        Research results: ${JSON.stringify(searchResults)}
                                        Analysis findings: ${JSON.stringify(
                                            stepIds.analysisSteps.map((step) => ({
                                                type: step.analysis.type,
                                                description: step.analysis.description,
                                                importance: step.analysis.importance,
                                            })),
                                        )}`,
                                });

                                // Send gap analysis update
                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: {
                                        id: 'gap-analysis',
                                        type: 'analysis',
                                        status: 'completed',
                                        title: 'Research Gaps and Limitations',
                                        analysisType: 'gaps',
                                        findings: gapAnalysis.limitations.map((l) => ({
                                            insight: l.description,
                                            evidence: l.potential_solutions,
                                            confidence: (6 - l.severity) / 5,
                                        })),
                                        gaps: gapAnalysis.knowledge_gaps,
                                        recommendations: gapAnalysis.recommended_followup,
                                        message: `Identified ${gapAnalysis.limitations.length} limitations and ${gapAnalysis.knowledge_gaps.length} knowledge gaps`,
                                        timestamp: Date.now(),
                                        overwrite: true,
                                        completedSteps: completedSteps + 1,
                                        totalSteps: totalSteps + (depth === 'advanced' ? 2 : 1),
                                    },
                                });

                                let synthesis;

                                // If there are significant gaps and depth is 'advanced', perform additional research
                                if (depth === 'advanced' && gapAnalysis.knowledge_gaps.length > 0) {
                                    // For important gaps, create 'all' source queries to be comprehensive
                                    const additionalQueries = gapAnalysis.knowledge_gaps.flatMap((gap) =>
                                        gap.additional_queries.map((query, idx) => {
                                            // For critical gaps, use 'all' sources for the first query
                                            // Distribute others across different source types for efficiency
                                            const sourceTypes = ['web', 'all'] as const;
                                            let source: 'web' | 'all';

                                            // Use 'all' for the first query of each gap, then rotate through specific sources
                                            if (idx === 0) {
                                                source = 'all';
                                            } else {
                                                source = sourceTypes[idx % (sourceTypes.length - 1)] as 'web' | 'all';
                                            }

                                            return {
                                                query,
                                                rationale: gap.reason,
                                                source,
                                                priority: 3,
                                            };
                                        }),
                                    );

                                    // Execute additional searches for gaps
                                    for (const query of additionalQueries) {
                                        // Generate a unique ID for this gap search
                                        const gapSearchId = `gap-search-${searchIndex++}`;

                                        // Execute search based on source type
                                        if (query.source === 'web' || query.source === 'all') {
                                            // Execute web search
                                            const webResults = await tvly.search(query.query, {
                                                searchDepth: depth,
                                                includeAnswer: true,
                                                maxResults: 5,
                                                includeDomains: [
                                                    'https://www.chromium.org/',
                                                    'https://web.dev',
                                                    'https://developer.chrome.com',
                                                    'https://developer.mozilla.org',
                                                    'https://dev.to',
                                                ],
                                            });

                                            // Add to search results
                                            searchResults.push({
                                                type: 'web',
                                                query: {
                                                    query: query.query,
                                                    rationale: query.rationale,
                                                    source: 'web',
                                                    priority: query.priority,
                                                },
                                                results: webResults.results.map((r) => ({
                                                    source: 'web',
                                                    title: r.title,
                                                    url: r.url,
                                                    content: r.content,
                                                })),
                                            });

                                            // Send completed annotation for web search
                                            dataStream.writeMessageAnnotation({
                                                type: 'research_update',
                                                data: {
                                                    id:
                                                        query.source === 'all'
                                                            ? `gap-search-web-${searchIndex - 3}`
                                                            : gapSearchId,
                                                    type: 'web',
                                                    status: 'completed',
                                                    title: `Additional web search for "${query.query}"`,
                                                    query: query.query,
                                                    results: webResults.results.map((r) => ({
                                                        source: 'web',
                                                        title: r.title,
                                                        url: r.url,
                                                        content: r.content,
                                                    })),
                                                    message: `Found ${webResults.results.length} results`,
                                                    timestamp: Date.now(),
                                                    overwrite: true,
                                                },
                                            });
                                        }
                                    }

                                    // Send running state for final synthesis
                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: 'final-synthesis',
                                            type: 'analysis',
                                            status: 'running',
                                            title: 'Final Research Synthesis',
                                            analysisType: 'synthesis',
                                            message: 'Synthesizing all research findings...',
                                            timestamp: Date.now(),
                                        },
                                    });

                                    // Perform final synthesis of all findings
                                    const { object: finalSynthesis } = await generateObject({
                                        model: scira.languageModel('scira-default'),
                                        temperature: 0,
                                        schema: z.object({
                                            key_findings: z.array(
                                                z.object({
                                                    finding: z.string(),
                                                    confidence: z.number().min(0).max(1),
                                                    supporting_evidence: z.array(z.string()),
                                                }),
                                            ),
                                            remaining_uncertainties: z.array(z.string()),
                                        }),
                                        prompt: `Synthesize all research findings, including gap analysis and follow-up research.
                                            Highlight key conclusions and remaining uncertainties.
                                            Stick to the types of the schema, do not add any other fields or types.
                                            
                                            Original results: ${JSON.stringify(searchResults)}
                                            Gap analysis: ${JSON.stringify(gapAnalysis)}
                                            Additional findings: ${JSON.stringify(additionalQueries)}
                                            IMPORTANT: ENSURE TO RETURN CONFIDENCE SCORES BETWEEN 0 AND 1.`,
                                    });

                                    synthesis = finalSynthesis;

                                    // Send final synthesis update
                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: 'final-synthesis',
                                            type: 'analysis',
                                            status: 'completed',
                                            title: 'Final Research Synthesis',
                                            analysisType: 'synthesis',
                                            findings: finalSynthesis.key_findings.map((f) => ({
                                                insight: f.finding,
                                                evidence: f.supporting_evidence,
                                                confidence: f.confidence,
                                            })),
                                            uncertainties: finalSynthesis.remaining_uncertainties,
                                            message: `Synthesized ${finalSynthesis.key_findings.length} key findings`,
                                            timestamp: Date.now(),
                                            overwrite: true,
                                            completedSteps: totalSteps + (depth === 'advanced' ? 2 : 1) - 1,
                                            totalSteps: totalSteps + (depth === 'advanced' ? 2 : 1),
                                        },
                                    });
                                }

                                // Final progress update
                                const finalProgress = {
                                    id: 'research-progress',
                                    type: 'progress' as const,
                                    status: 'completed' as const,
                                    message: `Research complete`,
                                    completedSteps: totalSteps + (depth === 'advanced' ? 2 : 1),
                                    totalSteps: totalSteps + (depth === 'advanced' ? 2 : 1),
                                    isComplete: true,
                                    timestamp: Date.now(),
                                };

                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: {
                                        ...finalProgress,
                                        overwrite: true,
                                    },
                                });

                                return {
                                    plan: researchPlan,
                                    results: searchResults,
                                    synthesis: synthesis,
                                };
                            },
                        }),
                    },
                    experimental_repairToolCall: async ({ toolCall, tools, parameterSchema, error }) => {
                        if (NoSuchToolError.isInstance(error)) {
                            return null; // do not attempt to fix invalid tool names
                        }

                        console.log('Fixing tool call================================');
                        console.log('toolCall', toolCall);
                        console.log('tools', tools);
                        console.log('parameterSchema', parameterSchema);
                        console.log('error', error);

                        const tool = tools[toolCall.toolName as keyof typeof tools];

                        const { object: repairedArgs } = await generateObject({
                            model: scira.languageModel('scira-default'),
                            schema: tool.parameters,
                            prompt: [
                                `The model tried to call the tool "${toolCall.toolName}"` +
                                    ` with the following arguments:`,
                                JSON.stringify(toolCall.args),
                                `The tool accepts the following schema:`,
                                JSON.stringify(parameterSchema(toolCall)),
                                'Please fix the arguments.',
                                'Do not use print statements stock chart tool.',
                                `For the stock chart tool you have to generate a python code with matplotlib and yfinance to plot the stock chart.`,
                                `For the web search make multiple queries to get the best results.`,
                                `Today's date is ${new Date().toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric',
                                })}`,
                            ].join('\n'),
                        });

                        console.log('repairedArgs', repairedArgs);

                        return { ...toolCall, args: JSON.stringify(repairedArgs) };
                    },
                    onChunk(event) {
                        if (event.chunk.type === 'tool-call') {
                            console.log('Called Tool: ', event.chunk.toolName);
                        }
                    },
                    onStepFinish(event) {
                        if (event.warnings) {
                            console.log('Warnings: ', event.warnings);
                        }
                    },
                    onFinish(event) {
                        console.log('Fin reason[1]: ', event.finishReason);
                        console.log('Reasoning[1]: ', event.reasoning);
                        console.log('reasoning details[1]: ', event.reasoningDetails);
                        console.log('Steps[1] ', event.steps);
                        console.log('Messages[1]: ', event.response.messages);
                    },
                    onError(event) {
                        console.log('Error: ', event.error);
                    },
                });

                toolsResult.mergeIntoDataStream(dataStream, {
                    experimental_sendFinish: false,
                });

                console.log('we got here');

                const { object: insightTopic } = await generateObject({
                    model: scira.languageModel('scira-default'),
                    temperature: 0,
                    messages: convertToCoreMessages(messages),
                    schema: z.object({
                        topic: z.nativeEnum(TraceTopic).describe('Topic of the trace'),
                    }),
                    system: `You are a web performance analysis expert specializing in Core Web Vitals. Your task is to analyze user queries about web performance issues, classify them into relevant categories.
Pick a topic from the schema given based on the user's message.
Use only the list of topics provided in the schema.

Those topics represent different aspects of a performance trace.

Core Web Vitals Context
Core Web Vitals are Google's metrics for measuring web page experience:

Loading (LCP): Largest Contentful Paint - measures loading performance (2.5s or less is good)
Interactivity (INP): Interaction to Next Paint - measures responsiveness (100ms or less is good)
Visual Stability (CLS): Cumulative Layout Shift - measures visual stability (0.1 or less is good)

Additional important metrics include:

TTFB (Time to First Byte)
FCP (First Contentful Paint)
TTI (Time to Interactive)
TBT (Total Blocking Time)
Resource optimization (JS, CSS, images, fonts)
Network performance (caching, compression)

Your Process

Analyze the user's query about web performance
Classify it into relevant web vitals categories

IMPORTANT: Use only the list of topics provided in the schema.`,
                });

                console.log({ insightTopic }, 'insightTopic!!!');
                let insightsForTopic;
                try {
                    insightsForTopic = await analyzeInsights(insights, userInteractions, insightTopic.topic);
                } catch (error) {
                    console.error('Error analyzing insights:', error);
                }

                const systemTemplate = `
You are Perf Agent, a report editor specializing in performance reports and core web vitals insights analysis. Your task is to produce a report based on the performance trace analysis and insights data.

## Core Web Vitals Context

Core Web Vitals are Google's metrics for measuring web page experience:
- **Loading (LCP)**: Largest Contentful Paint - measures loading performance
- **Interactivity (INP)**: Interaction to Next Paint - measures responsiveness
- **Visual Stability (CLS)**: Cumulative Layout Shift - measures visual stability

Additional important metrics include:
- TTFB - Time to First Byte - also related to the loading time
- FCP - First Contentful Paint - also related to the loading time
- TBT - Total Blocking Time - related to blocking resources and the main thread

## Your Process
- Analyze the trace insights and produce a report following the template below
- Introduce a section to breakdown some of the key insights data
- USE THE INSIGHTS FOR TOPIC TO WRITE THE REPORT SECTION ON THE TRACE ANALYSIS
- Example trace analysis bellow:
  
# <topic> report based on trace analysis

## Actionable Optimizations
** Your <topic> value is <metricValue from insights data> and your score is <metricScore from insights data> **

### <topic from insights data>
* <sub-topic from insights data>: your longest interaction event in the trace is about 100ms

Here's the trace analysis (DO NOT INCLUDE THIS DATA IN THE RESPONSE. USE IT TO WRITE THE REPORT SECTION ON THE TRACE ANALYSIS):
\`\`\`json
${JSON.stringify(insightsForTopic, null, 2)}
\`\`\`

FOLLOW THE REPORT STRUCTURE TO RESPOND.
`;

                const traceReportStream = streamText({
                    model: scira.languageModel('scira-default'),
                    temperature: 0,
                    messages: convertToCoreMessages(messages),
                    system: systemTemplate,
                });

                traceReportStream.mergeIntoDataStream(dataStream, {
                    experimental_sendStart: true,
                });

                const response = streamText({
                    model: scira.languageModel(model),
                    system: responseGuidelines,
                    experimental_transform: smoothStream({
                        chunking: 'word',
                        delayInMs: 15,
                    }),
                    messages: [...convertToCoreMessages(messages), ...(await toolsResult.response).messages],
                    onFinish(event) {
                        console.log('###########onFinish###########');
                        console.log('Fin reason[2]: ', event.finishReason);
                        console.log('Reasoning[2]: ', event.reasoning);
                        console.log('reasoning details[2]: ', event.reasoningDetails);
                        console.log('Steps[2] ', event.steps);
                        console.log('Messages[2]: ', event.response.messages);
                    },
                    onError(event) {
                        console.log('Error: ', event.error);
                    },
                });

                return response.mergeIntoDataStream(dataStream, {
                    experimental_sendFinish: true,
                });
            },
        });
    } else {
    }
}

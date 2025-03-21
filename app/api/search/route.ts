// /app/api/chat/route.ts
import { getGroupConfig } from '@/app/actions';
import { serverEnv } from '@/env/server';
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
import { createOpenAI } from '@ai-sdk/openai';
import { analyzeInsights, TraceTopic } from '@/lib/insights';

const openai = createOpenAI({
    // custom settings, e.g.
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama', // required but unused
    name: 'ollama',
    compatibility: 'strict', // strict mode, enable when using the OpenAI API
});

const scira = customProvider({
    languageModels: {
        'scira-default': openai('qwen2.5-coder:14b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-vision': openai('llama3.2-vision', { structuredOutputs: true, simulateStreaming: true }),
        'scira-llama': openai('llama3.1:8b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-sonnet': openai('mixtral:8x7b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-r1': wrapLanguageModel({
            model: openai('deepseek-r1:14b', { structuredOutputs: true, simulateStreaming: true }),
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
                console.log('we got here');

                const systemTemplate = `
You are Perf Agent, a report editor specializing in performance reports and core web vitals insights analysis.
Your task is to produce a report, following a given template, based on the performance trace analysis and insights data.

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
- Run the given tool to perform a trace analysis
- Analyze the trace insights and produce a report following the template below
- DO NOT INCLUDE ANY RESPONSE. THE TOOL CALL WILL PROVIDE THE RESPONSE

IMPORTANT:
- ALWAYS run the trace_analysis tool and use the insights for topic data to feed into the tool parameter schema
- OBEY THE TOOL PARAMETER SCHEMA
- DON'T INCLUDE ANYTHING IN THE RESPONSE
`;

                const traceReportStream = streamText({
                    model: scira.languageModel('scira-default'),
                    temperature: 0,
                    messages: convertToCoreMessages(messages),
                    system: systemTemplate,
                    toolChoice: 'required',
                    tools: {
                        trace_analysis: tool({
                            description: 'Perform a trace insight analysis and return data for the report',
                            parameters: z.object({
                                metric: z.string().describe('Metric to analyze').optional(),
                                metricType: z.string().describe('Metric type to analyze').optional(),
                            }),
                            execute: async (args) => {
                                console.log(
                                    '######################### TRACE REASON SEARCH #################################',
                                    args,
                                );
                                // Send running state for insights analysis
                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: {
                                        id: 'trace-insights',
                                        type: 'trace-insight',
                                        status: 'running',
                                        title: 'Performance Insights Analysis',
                                        message: 'Analyzing performance insights...',
                                        timestamp: Date.now(),
                                    },
                                });

                                const { object: insightTopic } = await generateObject({
                                    model: scira.languageModel('scira-default'),
                                    temperature: 0,
                                    messages: convertToCoreMessages(messages),
                                    schema: z.object({
                                        topic: z.nativeEnum(TraceTopic).describe('Topic of the trace'),
                                        researchTopic: z
                                            .string()
                                            .describe('Research topic basd on the topic user query'),
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
                                    insightsForTopic = await analyzeInsights(
                                        insights,
                                        userInteractions,
                                        insightTopic.topic,
                                    );
                                } catch (error) {
                                    console.error('Error analyzing insights:', error);
                                }

                                // Add this before traceReportStream
                                if (insightsForTopic) {
                                    console.log(
                                        '######################### sending annotations for trace-insight #################################',
                                    );

                                    // Send completed state with insights data
                                    dataStream.writeMessageAnnotation({
                                        type: 'research_update',
                                        data: {
                                            id: 'trace-insights',
                                            type: 'trace-insight',
                                            status: 'completed',
                                            title: `${insightsForTopic.metric} Analysis`,
                                            message: `Analyzed ${insightsForTopic.metric} performance`,
                                            timestamp: Date.now(),
                                            traceInsight: {
                                                metric: insightsForTopic.metric,
                                                metricValue: insightsForTopic.metricValue,
                                                metricType: insightsForTopic.metricType,
                                                metricScore: insightsForTopic.metricScore as
                                                    | 'good'
                                                    | 'average'
                                                    | 'poor',
                                                metricBreakdown: insightsForTopic.metricBreakdown,
                                                infoContent: insightsForTopic.infoContent,
                                            },
                                            overwrite: true,
                                        },
                                    });
                                }

                                const reportTemplate = `
You are Perf Agent, a report editor specializing in performance reports and core web vitals insights analysis.
Your task is to produce a report, following a given template, based on the performance trace analysis and insights data.

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
**Your <topic> value is <metricValue from insights data> and your score is <metricScore from insights data>**

### <topic from insights data>
* <sub-topic from insights data>: your longest interaction event in the trace is about 100ms


IMPORTANT:
- ALWAYS FOLLOW THE REPORT TEMPLATE STRUCTURE ABOVE TO RESPOND.
- DON'T INCLUDE ANYTHING ELSE IN THE RESPONSE OTHER THAN THE REPORT FOLLOWING THE TEMPLATE STRUCTURE ABOVE

Here's the trace analysis (DO NOT INCLUDE THIS DATA IN THE RESPONSE. USE IT TO WRITE THE REPORT SECTION ON THE TRACE ANALYSIS):
\`\`\`json
${JSON.stringify(insightsForTopic, null, 2)}
\`\`\`
`;

                                const reportStream = streamText({
                                    model: scira.languageModel('scira-default'),
                                    temperature: 0,
                                    messages: convertToCoreMessages(messages),
                                    system: reportTemplate,
                                });

                                reportStream.mergeIntoDataStream(dataStream);

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

                                const depth = 'advanced';

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
                                    prompt: `Create a focused research plan for the topic: "${
                                        insightTopic.researchTopic
                                    }".

                                                        Today's date and day of the week: ${new Date().toLocaleDateString(
                                                            'en-US',
                                                            {
                                                                weekday: 'long',
                                                                year: 'numeric',
                                                                month: 'long',
                                                                day: 'numeric',
                                                            },
                                                        )}

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
                                let completedSteps = 1;
                                const totalSteps = stepIds.searchSteps.length + stepIds.analysisSteps.length + 1;

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

                                const researchReport = streamText({
                                    model: scira.languageModel('scira-default'),
                                    temperature: 0,
                                    system: responseGuidelines,
                                    messages: [
                                        ...convertToCoreMessages(messages),
                                        {
                                            role: 'user',
                                            content: `
                                            Research plan: ${JSON.stringify(researchPlan)}
                                            Search results: ${JSON.stringify(searchResults)}
                                            Synthesis: ${JSON.stringify(synthesis)}
                                            `,
                                        },
                                    ],
                                });

                                const finalProgress = {
                                    id: 'research-progress',
                                    type: 'progress' as const,
                                    status: 'completed' as const,
                                    message: `Trace analysis complete`,
                                    completedSteps: totalSteps + (depth === 'advanced' ? 2 : 1),
                                    totalSteps: totalSteps + (depth === 'advanced' ? 2 : 1),
                                    isComplete: true,
                                    timestamp: Date.now(),
                                };

                                dataStream.writeMessageAnnotation({
                                    type: 'research_update',
                                    data: finalProgress,
                                    overwrite: true,
                                });

                                researchReport.mergeIntoDataStream(dataStream);

                                return {
                                    metric: args.metric,
                                    metricValue: insightsForTopic.metricValue,
                                    metricType: insightsForTopic.metricType,
                                    metricScore: insightsForTopic.metricScore as 'good' | 'average' | 'poor',
                                    metricBreakdown: insightsForTopic.metricBreakdown,
                                    insightsForTopic,
                                };
                            },
                        }),
                    },
                    onFinish(event) {
                        console.log(
                            '######################### traceReportStream onFinish #################################',
                        );
                        console.log('Fin reason[2]: ', event.finishReason);
                        console.log('Reasoning[2]: ', event.reasoning);
                        console.log('reasoning details[2]: ', event.reasoningDetails);
                        console.log('Messages [2]: ', event.response.messages);
                    },
                    onError(event) {
                        console.log('Error: ', event.error);
                    },
                });

                return traceReportStream.mergeIntoDataStream(dataStream, {
                    experimental_sendStart: true,
                });

                // console.log('######################### traceReportStream #################################');

                // const response = streamText({
                //     model: scira.languageModel(model),
                //     system: responseGuidelines,
                //     experimental_transform: smoothStream({
                //         chunking: 'word',
                //         delayInMs: 15,
                //     }),
                //     messages: [...convertToCoreMessages(messages), ...(await toolsResult.response).messages],
                //     onFinish(event) {
                //         console.log('###########onFinish###########');
                //         console.log('Fin reason[2]: ', event.finishReason);
                //         console.log('Reasoning[2]: ', event.reasoning);
                //         console.log('reasoning details[2]: ', event.reasoningDetails);
                //         console.log('Steps[2] ', event.steps);
                //         console.log('Messages[2]: ', event.response.messages);
                //     },
                //     onError(event) {
                //         console.log('Error: ', event.error);
                //     },
                // });

                // return response.mergeIntoDataStream(dataStream, {
                //     experimental_sendFinish: true,
                // });
            },
        });
    } else {
    }
}

// /app/api/chat/route.ts
import { getGroupConfig } from '@/app/actions';
import { serverEnv } from '@/env/server';
import CodeInterpreter from '@e2b/code-interpreter';
import { tavily } from '@tavily/core';
import {
    convertToCoreMessages,
    smoothStream,
    streamText,
    tool,
    createDataStreamResponse,
    customProvider,
    generateObject,
} from 'ai';
import { z } from 'zod';
import { ollama } from 'ollama-ai-provider';

const scira = customProvider({
    languageModels: {
        'scira-default': ollama('qwen2.5-coder:14b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-llama': ollama('llama3.1:8b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-sonnet': ollama('mixtral:8x7b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-r1': ollama('deepseek-r1:14b', { structuredOutputs: true, simulateStreaming: true }),
        'scira-llama-groq': ollama('llama3.1:8b', { structuredOutputs: true, simulateStreaming: true }),
    },
});

// Allow streaming responses up to 120 seconds
export const maxDuration = 300;

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
    const { messages, model, group } = await req.json();
    const { tools: activeTools, systemPrompt } = await getGroupConfig(group);

    console.log('Running with model: ', model.trim());
    console.log('Messages: ', messages);
    console.log('Active Tools: ', activeTools);
    console.log('Group: ', group);
    console.log('System Prompt: ', systemPrompt);

    return createDataStreamResponse({
        execute: async (dataStream) => {
            const result = streamText({
                model: scira.languageModel(model),
                maxSteps: 15,
                providerOptions: {
                    scira: {
                        reasoning_format: group === 'fun' ? 'raw' : 'parsed',
                    },
                },
                messages: convertToCoreMessages(messages),
                experimental_transform: smoothStream({
                    chunking: 'word',
                    delayInMs: 15,
                }),
                temperature: 0,
                experimental_activeTools: [...activeTools],
                system: systemPrompt,
                tools: {
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
                            console.log('Web Search Tool Called');
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
                                          ).then((results) => results.filter((url): url is string => url !== null)),
                                };
                            });
                            const searchResults = await Promise.all(searchPromises);
                            return {
                                searches: searchResults,
                            };
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
                    reason_search: tool({
                        description: 'Perform a reasoned web search with multiple steps and sources.',
                        parameters: z.object({
                            topic: z.string().describe('The main topic or question to research'),
                            depth: z.enum(['basic', 'advanced']).describe('Search depth level').default('basic'),
                        }),
                        execute: async ({ topic, depth }: { topic: string; depth: 'basic' | 'advanced' }) => {
                            console.log('Reason Search Tool Called');
                            console.log('Topic: ', topic);
                            console.log('Depth: ', depth);
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
                            console.log('Topic: ', topic);
                            console.log('Depth: ', depth);
                            // Now generate the research plan
                            const { object: researchPlan } = await generateObject({
                                model: ollama('llama3.1:8b', { structuredOutputs: true, simulateStreaming: true }),
                                temperature: 0.5,
                                system: `You are a research assistant.
                                PAY ATTENTION TO THE DEPTH AND THE TOPIC.
                                PAY ATTENTION TO THE PRIORITY AND IMPORTANCE RANGE OF THE QUERIES (between 1 and 5).
                                YOU MUST RESPECT THE SCHEMA GIVEN.`,
                                schema: z.object({
                                    search_queries: z
                                        .array(
                                            z.object({
                                                query: z.string(),
                                                rationale: z.string(),
                                                source: z.enum(['web', 'academic', 'both']),
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
                                        Keep the plan concise but comprehensive, with:
                                        - 4-12 targeted search queries (each can use web, academic, or both sources)
                                        - 2-8 key analyses to perform
                                        - Prioritize the most important aspects to investigate
                                        Consider different angles and potential controversies, but maintain focus on the core aspects.
                                        Ensure the total number of steps (searches + analyses) does not exceed 20.`,
                            });
                            console.log('Research Plan: ', researchPlan);
                            // Generate IDs for all steps based on the plan
                            const generateStepIds = (plan: typeof researchPlan) => {
                                // Generate an array of search steps.
                                const searchSteps = plan.search_queries.flatMap((query, index) => {
                                    if (query.source === 'both') {
                                        return [
                                            { id: `search-web-${index}`, type: 'web', query },
                                            { id: `search-academic-${index}`, type: 'academic', query },
                                        ];
                                    }
                                    const searchType = query.source === 'academic' ? 'academic' : 'web';
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
                            console.log('Step IDs: ', stepIds);
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
                                        title:
                                            step.type === 'web'
                                                ? `Searching the web for "${step.query.query}"`
                                                : step.type === 'academic'
                                                ? `Searching academic papers for "${step.query.query}"`
                                                : `Analyzing ${step.query.query}`,
                                        query: step.query.query,
                                        message: `Searching ${step.query.source} sources...`,
                                        timestamp: Date.now(),
                                    },
                                });
                                if (step.type === 'web' || step.type === 'academic') {
                                    const webResults = await tvly.search(step.query.query, {
                                        searchDepth: depth,
                                        includeAnswer: true,
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
                                    model: ollama('llama3.1:8b', { structuredOutputs: true, simulateStreaming: true }),
                                    temperature: 0.5,
                                    system: `You are a research assistant. The confidence of the evidence is a number between 0 and 1 representing a percentage. RESPECT THE SCHEMA GIVEN.
                                    `,
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
                                            Search results: ${JSON.stringify(searchResults)}`,
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
                            // Before returning, ensure we mark as complete if response is done
                            completedSteps =
                                searchResults.reduce((acc, search) => {
                                    // Count each search result as a step
                                    return acc + (search.type === 'both' ? 2 : 1);
                                }, 0) + researchPlan.required_analyses.length;
                            const finalProgress = {
                                id: 'research-progress',
                                type: 'progress' as const,
                                status: 'completed' as const,
                                message: `Research complete: ${completedSteps}/${totalSteps} steps finished`,
                                completedSteps,
                                totalSteps,
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
                            };
                        },
                    }),
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
                    console.log('Fin reason: ', event.finishReason);
                    console.log('Steps ', event.steps);
                    console.log('Messages: ', JSON.stringify(event.response.messages));
                },
                onError(event) {
                    console.log('Error: ', event.error);
                },
            });

            // result.consumeStream();

            return result.mergeIntoDataStream(dataStream, {
                sendReasoning: true,
            });
        },
    });
}

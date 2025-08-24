import { tool } from 'ai';
import { z } from 'zod';
import { KnowledgeBase } from '@/lib/rag/knowledge-base';
import { auth } from '@/app/(auth)/auth';

export const searchKnowledgeTool = tool({
  description:
    'Search uploaded documents for detailed information to provide comprehensive answers to user questions about courses, programs, or institutional information',
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'The search query to find relevant information from uploaded documents',
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe('Maximum number of results to return'),
  }),
  execute: async ({ query, limit }) => {
    try {
      const session = await auth();

      if (!session?.user?.id) {
        return {
          success: false,
          message: 'Authentication required',
          results: [],
        };
      }

      const knowledgeBase = new KnowledgeBase();
      const results = await knowledgeBase.searchSimilar(
        query,
        limit,
        0.2,
        session.user.id,
      );

      if (results.length === 0) {
        return {
          success: false,
          message: 'No relevant information found in uploaded documents.',
          results: [],
        };
      }

      // Combine and deduplicate content for more comprehensive results
      const allContent = results
        .map((result) => result.chunk.content)
        .join('\n\n');
      const sources = [
        ...new Set(results.map((result) => result.document.title)),
      ];

      return {
        success: true,
        message: `Found detailed information from ${sources.length} document(s)`,
        content: allContent,
        sources: sources,
        totalChunks: results.length,
        results: results.map((result, index) => ({
          rank: index + 1,
          content: result.chunk.content,
          source: result.document.title,
          filename: result.document.filename,
          similarity: Math.round(result.similarity * 100),
        })),
      };
    } catch (error) {
      console.error('Error searching documents:', error);
      return {
        success: false,
        message: 'Error searching documents',
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
});

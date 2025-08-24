import {
  knowledgeDocument,
  documentChunk,
  type KnowledgeDocument,
  type DocumentChunk,
} from '@/lib/db/schema';
import { eq, sql, desc, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { FreeDocumentProcessor as DocumentProcessor } from './free-document-processor';

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL environment variable is required');
}

const client = postgres(process.env.POSTGRES_URL);
const db = drizzle(client);

export interface SearchResult {
  chunk: DocumentChunk;
  document: KnowledgeDocument;
  similarity: number;
}

export class KnowledgeBase {
  private processor: DocumentProcessor;

  constructor() {
    this.processor = new DocumentProcessor();
  }

  async addDocument(
    buffer: Buffer,
    filename: string,
    fileType: string,
    title: string,
    userId: string,
  ): Promise<KnowledgeDocument> {
    try {
      const processed = await this.processor.processDocument(
        buffer,
        filename,
        fileType,
      );

      const [document] = await db
        .insert(knowledgeDocument)
        .values({
          title,
          filename,
          fileType: fileType as 'pdf' | 'txt' | 'image',
          content: processed.content,
          fileSize: processed.metadata.fileSize,
          userId,
        })
        .returning();

      // Insert document chunks with embeddings
      for (const chunk of processed.chunks) {
        await db.insert(documentChunk).values({
          documentId: document.id,
          content: chunk.content,
          embedding: chunk.embedding,
          chunkIndex: chunk.chunkIndex,
          metadata: chunk.metadata,
        });
      }

      return document;
    } catch (error) {
      console.error('Error adding document to knowledge base:', error);
      throw new Error('Failed to add document to knowledge base');
    }
  }

  async searchSimilar(
    query: string,
    limit = 5,
    similarityThreshold = 0.1,
    userId?: string,
  ): Promise<SearchResult[]> {
    try {
      const queryEmbedding = await this.processor.embedQuery(query);

      // Build the similarity search query using cosine similarity
      const whereConditions = [
        sql`1 - (${documentChunk.embedding} <=> ${JSON.stringify(queryEmbedding)}) > ${similarityThreshold}`,
      ];

      if (userId) {
        whereConditions.push(eq(knowledgeDocument.userId, userId));
      }

      const results = await db
        .select({
          chunk: documentChunk,
          document: knowledgeDocument,
          similarity: sql<number>`1 - (${documentChunk.embedding} <=> ${JSON.stringify(queryEmbedding)})`,
        })
        .from(documentChunk)
        .innerJoin(
          knowledgeDocument,
          eq(documentChunk.documentId, knowledgeDocument.id),
        )
        .where(and(...whereConditions))
        .orderBy(
          sql`1 - (${documentChunk.embedding} <=> ${JSON.stringify(queryEmbedding)}) DESC`,
        )
        .limit(limit);

      return results.map((result) => ({
        chunk: result.chunk,
        document: result.document,
        similarity: result.similarity,
      }));
    } catch (error) {
      console.error('Error searching knowledge base:', error);
      throw new Error('Failed to search knowledge base');
    }
  }

  async getDocuments(userId: string): Promise<KnowledgeDocument[]> {
    return await db
      .select()
      .from(knowledgeDocument)
      .where(eq(knowledgeDocument.userId, userId))
      .orderBy(desc(knowledgeDocument.uploadedAt));
  }

  async deleteDocument(documentId: string, userId: string): Promise<void> {
    await db
      .delete(knowledgeDocument)
      .where(
        sql`${knowledgeDocument.id} = ${documentId} AND ${knowledgeDocument.userId} = ${userId}`,
      );
  }

  async getDocumentChunks(documentId: string): Promise<DocumentChunk[]> {
    return await db
      .select()
      .from(documentChunk)
      .where(eq(documentChunk.documentId, documentId))
      .orderBy(documentChunk.chunkIndex);
  }

  async reprocessDocument(documentId: string, userId: string): Promise<void> {
    try {
      const [document] = await db
        .select()
        .from(knowledgeDocument)
        .where(
          sql`${knowledgeDocument.id} = ${documentId} AND ${knowledgeDocument.userId} = ${userId}`,
        )
        .limit(1);

      if (!document) {
        throw new Error('Document not found or access denied');
      }

      // For this implementation, we'll need the original file buffer
      // Since we don't store the original file, we'll just update existing content
      // This is a simplified approach - in production, you might want to store original files
      console.log('Reprocessing document:', document.filename);

      await db
        .delete(documentChunk)
        .where(eq(documentChunk.documentId, documentId));

      const content = `This document (${document.filename}) needs to be re-uploaded to extract its content properly. The PDF text extraction has been improved and will now work correctly for new uploads.`;

      await db
        .update(knowledgeDocument)
        .set({ content })
        .where(eq(knowledgeDocument.id, documentId));

      const processed = await this.processor.processDocument(
        Buffer.from(content),
        document.filename,
        'txt',
      );

      for (const chunk of processed.chunks) {
        await db.insert(documentChunk).values({
          documentId: document.id,
          content: chunk.content,
          embedding: chunk.embedding,
          chunkIndex: chunk.chunkIndex,
          metadata: chunk.metadata,
        });
      }
    } catch (error) {
      console.error('Error reprocessing document:', error);
      throw new Error('Failed to reprocess document');
    }
  }
}

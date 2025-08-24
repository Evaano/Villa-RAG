import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import sharp from 'sharp';

export interface ProcessedDocument {
  content: string;
  chunks: DocumentChunk[];
  metadata: {
    filename: string;
    fileType: string;
    fileSize: number;
    totalChunks: number;
  };
}

export interface DocumentChunk {
  content: string;
  embedding: number[];
  chunkIndex: number;
  metadata: Record<string, any>;
}

export class DocumentProcessor {
  private embeddings: OpenAIEmbeddings;
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    this.embeddings = new OpenAIEmbeddings({
      model: 'text-embedding-3-small',
      dimensions: 1536,
    });

    this.textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
      separators: ['\n\n', '\n', '. ', ' ', ''],
    });
  }

  async processDocument(
    buffer: Buffer,
    filename: string,
    fileType: string,
  ): Promise<ProcessedDocument> {
    let content: string;

    switch (fileType.toLowerCase()) {
      case 'pdf':
        content = await this.processPDF(buffer);
        break;
      case 'txt':
        content = buffer.toString('utf-8');
        break;
      case 'image':
        content = await this.processImage(buffer);
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }

    const chunks = await this.createChunks(content, filename);

    return {
      content,
      chunks,
      metadata: {
        filename,
        fileType,
        fileSize: buffer.length,
        totalChunks: chunks.length,
      },
    };
  }

  private async processPDF(buffer: Buffer): Promise<string> {
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

      const pdfDocument = await pdfjsLib.getDocument({
        data: buffer,
        isEvalSupported: false,
      }).promise;

      let fullText = '';

      for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += `${pageText}\n`;
      }

      return fullText.trim();
    } catch (error) {
      console.error('Error processing PDF:', error);
      throw new Error('Failed to process PDF file');
    }
  }

  private async processImage(buffer: Buffer): Promise<string> {
    try {
      const processedBuffer = await sharp(buffer)
        .png()
        .greyscale()
        .normalize()
        .toBuffer();

      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      const {
        data: { text },
      } = await worker.recognize(processedBuffer);
      await worker.terminate();

      return text;
    } catch (error) {
      console.error('Error processing image:', error);
      throw new Error('Failed to process image file');
    }
  }

  private async createChunks(
    content: string,
    filename: string,
  ): Promise<DocumentChunk[]> {
    const textChunks = await this.textSplitter.splitText(content);
    const chunks: DocumentChunk[] = [];

    for (let i = 0; i < textChunks.length; i++) {
      const chunkContent = textChunks[i];
      const embedding = await this.embeddings.embedQuery(chunkContent);

      chunks.push({
        content: chunkContent,
        embedding,
        chunkIndex: i,
        metadata: {
          filename,
          chunkLength: chunkContent.length,
          totalChunks: textChunks.length,
        },
      });
    }

    return chunks;
  }

  async embedQuery(query: string): Promise<number[]> {
    return await this.embeddings.embedQuery(query);
  }
}

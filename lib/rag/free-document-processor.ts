import { HfInference } from '@huggingface/inference';
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

export class FreeDocumentProcessor {
  private hf: HfInference;
  private textSplitter: RecursiveCharacterTextSplitter;

  constructor() {
    const hfToken = process.env.HUGGINGFACE_API_KEY;
    this.hf = new HfInference(hfToken);

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
      const PDFParser = (await import('pdf2json')).default;

      return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();

        pdfParser.on('pdfParser_dataError', (errData: any) => {
          console.error('PDF parsing error:', errData.parserError);
          reject(new Error('Failed to parse PDF'));
        });

        pdfParser.on('pdfParser_dataReady', (pdfData: any) => {
          try {
            let text = '';

            if (pdfData.Pages) {
              for (const page of pdfData.Pages) {
                if (page.Texts) {
                  for (const textItem of page.Texts) {
                    if (textItem.R) {
                      for (const run of textItem.R) {
                        if (run.T) {
                          text += `${decodeURIComponent(run.T)} `;
                        }
                      }
                    }
                  }
                  text += '\n';
                }
              }
            }

            const cleanText = text.trim();
            if (cleanText.length === 0) {
              resolve(
                `[PDF Content] - This PDF appears to be empty or contains only images. File size: ${buffer.length} bytes.`,
              );
            } else {
              resolve(cleanText);
            }
          } catch (parseError) {
            console.error('Error extracting text from PDF data:', parseError);
            resolve(
              `[PDF Content] - Could not extract text from this PDF. It may contain only images or be encrypted. File size: ${buffer.length} bytes.`,
            );
          }
        });

        pdfParser.parseBuffer(buffer);
      });
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

      try {
        let embedding: any;

        const models = [
          'sentence-transformers/paraphrase-MiniLM-L6-v2',
          'sentence-transformers/all-MiniLM-L6-v2',
          'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
        ];

        let success = false;
        for (const model of models) {
          try {
            embedding = await this.hf.featureExtraction({
              model,
              inputs: chunkContent,
            });
            success = true;
            break;
          } catch (modelError) {
            console.warn(`Model ${model} failed, trying next...`);
            continue;
          }
        }

        if (!success) {
          throw new Error('All embedding models failed');
        }

        const flatEmbedding = Array.isArray(embedding[0])
          ? (embedding[0] as number[])
          : (embedding as number[]);

        chunks.push({
          content: chunkContent,
          embedding: flatEmbedding as number[],
          chunkIndex: i,
          metadata: {
            filename,
            chunkLength: chunkContent.length,
            totalChunks: textChunks.length,
          },
        });
      } catch (error) {
        console.warn(
          `Error creating embedding for chunk ${i}, using fallback:`,
          error,
        );
        // Fallback: create deterministic hash-based embedding
        const fallbackEmbedding = this.createHashBasedEmbedding(chunkContent);
        chunks.push({
          content: chunkContent,
          embedding: fallbackEmbedding,
          chunkIndex: i,
          metadata: {
            filename,
            chunkLength: chunkContent.length,
            totalChunks: textChunks.length,
            fallback: true,
          },
        });
      }
    }

    return chunks;
  }

  async embedQuery(query: string): Promise<number[]> {
    try {
      const models = [
        'sentence-transformers/paraphrase-MiniLM-L6-v2',
        'sentence-transformers/all-MiniLM-L6-v2',
        'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      ];

      for (const model of models) {
        try {
          const embedding = await this.hf.featureExtraction({
            model,
            inputs: query,
          });

          // Convert to flat array if needed
          return Array.isArray(embedding[0])
            ? (embedding[0] as number[])
            : (embedding as number[]);
        } catch (modelError) {
          console.warn(`Model ${model} failed for query, trying next...`);
          continue;
        }
      }

      throw new Error('All query embedding models failed');
    } catch (error) {
      console.warn('Error creating query embedding, using fallback:', error);
      // Fallback: create deterministic hash-based representation
      return this.createHashBasedEmbedding(query);
    }
  }

  private createHashBasedEmbedding(text: string): number[] {
    // Create a deterministic embedding based on text content
    const embedding = new Array(384).fill(0);

    // Simple hash function to create deterministic values
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }

    // Fill embedding with deterministic values based on hash
    for (let i = 0; i < 384; i++) {
      const seed = hash + i;
      embedding[i] = (Math.sin(seed) * 43758.5453) % 1; // Pseudo-random but deterministic
    }

    return embedding;
  }
}

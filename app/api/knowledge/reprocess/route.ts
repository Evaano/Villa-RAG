import { type NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/(auth)/auth';
import { KnowledgeBase } from '@/lib/rag/knowledge-base';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { documentId } = await request.json();

    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID required' },
        { status: 400 },
      );
    }

    const knowledgeBase = new KnowledgeBase();
    await knowledgeBase.reprocessDocument(documentId, session.user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error reprocessing document:', error);
    return NextResponse.json(
      { error: 'Failed to reprocess document' },
      { status: 500 },
    );
  }
}

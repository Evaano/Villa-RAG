import { auth } from '@/app/(auth)/auth';
import { KnowledgeUpload } from '@/components/knowledge-upload';
import { redirect } from 'next/navigation';

export default async function KnowledgePage() {
  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Knowledge Base</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Upload documents about your college to create a comprehensive
          knowledge base. The chatbot will use this information to answer
          questions about your institution.
        </p>
      </div>

      <KnowledgeUpload />
    </div>
  );
}

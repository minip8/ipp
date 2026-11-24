import type { Metadata } from 'next';
import { QuestionBank } from '@/features/quiz/bank';

export const metadata: Metadata = { title: 'Question bank' };

export default async function QuestionBankPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <QuestionBank topic={slug} />;
}

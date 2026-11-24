import type { Metadata } from 'next';
import { QuestionBank } from '@/features/quiz/bank';

export const metadata: Metadata = { title: 'Question bank' };

export default async function QuestionBankPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Keyed by topic: search text and what was answered on the page belong to one bank.
  return <QuestionBank key={slug} topic={slug} />;
}

import { redirect } from 'next/navigation';

/** Topics are picked on the hub; without this, /quiz/topics would be read as an attempt id. */
export default function QuizTopicsPage() {
  redirect('/quiz');
}

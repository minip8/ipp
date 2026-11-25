'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

export function NewRedirect() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const query = params.toString();
    router.replace(query ? `/dashboard?${query}` : '/dashboard');
  }, [router, params]);
  return null;
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ReversalScannerRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/laxprime');
  }, [router]);

  return null;
}

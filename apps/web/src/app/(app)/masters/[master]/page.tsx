'use client';
import { notFound, useParams } from 'next/navigation';
import { MasterPage } from '@/components/master-page';
import { MASTER_CONFIGS } from '@/lib/masters';

export default function MasterRoute() {
  const { master } = useParams<{ master: string }>();
  const cfg = MASTER_CONFIGS[master];
  if (!cfg) notFound();
  return <MasterPage key={master} cfg={cfg} />;
}

import { redirect } from 'next/navigation';
import { DASHBOARD } from '@/lib/supabase/cookies';

export default function ClientIndex() {
  redirect(DASHBOARD.client);
}

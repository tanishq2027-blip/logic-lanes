import { redirect } from 'next/navigation';
import { DASHBOARD } from '@/lib/supabase/cookies';

export default function DriverIndex() {
  redirect(DASHBOARD.driver);
}

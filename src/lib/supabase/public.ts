import "server-only";

import { createClient } from "@supabase/supabase-js";

/** 공개 RLS/RPC 전용 클라이언트. 요청 쿠키를 읽지 않아 정적 생성에서도 사용할 수 있다. */
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    }
  );
}

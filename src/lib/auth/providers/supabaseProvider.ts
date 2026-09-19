/**
 * Supabase Auth 空壳 Provider（生产模式扩展点）
 *
 * 真实集成时：
 * 1. 写入 .env.local：NEXT_PUBLIC_AUTH_PROVIDER=supabase
 * 2. 填 NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
 * 3. 用 supabase-js 实例替换下面的 stub 方法
 *
 * 目前演示模式下该 Provider 不会被调用，保留接口避免业务代码改动。
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost/stub-supabase';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'STUB_ANON_KEY_DO_NOT_USE_IN_PROD';

export const supabaseStubClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

export async function signInWithEmail(_email: string, _password: string): Promise<never> {
  throw new Error(
    '[RBAC] Supabase Auth provider not configured — set NEXT_PUBLIC_AUTH_PROVIDER=supabase and fill SUPABASE_URL + SUPABASE_ANON_KEY in .env.local first. Currently using MOCK demo auth.'
  );
}

export async function signOut(): Promise<never> {
  throw new Error(
    '[RBAC] Supabase Auth signOut stub: switch NEXT_PUBLIC_AUTH_PROVIDER=supabase to enable real backend.'
  );
}

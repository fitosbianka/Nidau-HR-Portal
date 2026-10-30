'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function signIn(formData: FormData): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) {
    redirect('/login?error=credentials')
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?error=credentials')

  const admin = await createAdminClient()

  await admin
    .from('profiles')
    .update({ last_login: new Date().toISOString() })
    .eq('id', user.id)

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const role = (profile as { role: string } | null)?.role
  redirect(role === 'admin' ? '/admin' : '/employee')
}

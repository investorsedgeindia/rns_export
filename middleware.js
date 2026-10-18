import { createServerClient } from '@supabase/ssr';

const ADMIN_EMAIL = 'bandhupremagency@gmail.com';

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (pathname !== '/admin.html' && pathname !== '/admin') {
    return;
  }

  const response = new Response();

  const supabase = createServerClient(
    'https://lvzmkbgduelpngjnsgdu.supabase.co',
    'sb_publishable_oi31ZqkSDau8ace9TZM8uA_NzDzsv5z',
    {
      cookies: {
        get(name) {
          return request.cookies.get(name)?.value;
        },
        set(name, value, options) {
          response.cookies.set({ name, value, ...options });
        },
        remove(name, options) {
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.email !== ADMIN_EMAIL) {
    return new Response(null, { status: 403, statusText: 'Forbidden' });
  }

  return;
}

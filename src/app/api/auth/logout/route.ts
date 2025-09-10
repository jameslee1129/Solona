export const runtime = "nodejs";

export async function POST() {
  const headers = new Headers();
  headers.append("Set-Cookie", "app_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}


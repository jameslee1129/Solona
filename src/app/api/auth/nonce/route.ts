import { NextRequest } from "next/server";

export const runtime = "nodejs";

function generateNonce(length = 32) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export async function GET(_req: NextRequest) {
  const nonce = generateNonce(48);
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `login_nonce=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
  );
  return new Response(JSON.stringify({ nonce }), { status: 200, headers });
}


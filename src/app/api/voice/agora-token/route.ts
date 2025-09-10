import { NextRequest } from "next/server";
import { RtcRole, RtcTokenBuilder } from "agora-access-token";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const channel = String(body?.channel || "GLOBAL");
    const uid = String(body?.uid || "0");
    const expireSeconds = Number(body?.expireSeconds || 3600);

    const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID;
    const appCertificate = process.env.AGORA_APP_CERTIFICATE;
    if (!appId || !appCertificate) {
      return new Response(JSON.stringify({ error: "agora_env_missing" }), { status: 500 });
    }

    const currentTs = Math.floor(Date.now() / 1000);
    const privilegeExpireTs = currentTs + expireSeconds;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channel,
      Number(uid),
      RtcRole.PUBLISHER,
      privilegeExpireTs
    );

    return new Response(JSON.stringify({ appId, channel, uid, token, expireAt: privilegeExpireTs }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "unknown" }), { status: 500 });
  }
}


"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IAgoraRTCClient, ILocalAudioTrack, IRemoteAudioTrack } from "agora-rtc-sdk-ng";
import AgoraRTC from "agora-rtc-sdk-ng";

export default function VoiceChatAgora({ market, autoJoinDefault }: { market?: string; autoJoinDefault?: boolean }) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [status, setStatus] = useState("Disconnected");
  const [level, setLevel] = useState(0);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localTrackRef = useRef<ILocalAudioTrack | null>(null);
  const remoteTracksRef = useRef<Map<string, IRemoteAudioTrack>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [remoteCount, setRemoteCount] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const srcNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const channelName = useMemo(() => (market || "GLOBAL").toUpperCase().replace(/[^A-Z0-9]/g, ""), [market]);

  useEffect(() => {
    // Disable Agora SDK logging completely
    AgoraRTC.setLogLevel(4); // 4 = NONE level, disables all console logging from Agora SDK
    
    const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
    clientRef.current = client;

    client.on("user-published", async (user, mediaType) => {
      try {
        await client.subscribe(user, mediaType);
        if (mediaType === "audio") {
          const track = user.audioTrack as IRemoteAudioTrack | null;
          if (track) {
            remoteTracksRef.current.set(String(user.uid), track);
            const el = new Audio();
            el.autoplay = true;
            el.muted = deafened;
            track.play(el);
            audioElsRef.current.set(String(user.uid), el);
            setRemoteCount(remoteTracksRef.current.size);
          }
        }
      } catch {}
    });

    client.on("user-unpublished", (user) => {
      const uid = String(user.uid);
      const el = audioElsRef.current.get(uid);
      if (el) {
        try { el.srcObject = null; } catch {}
        audioElsRef.current.delete(uid);
      }
      remoteTracksRef.current.delete(uid);
      setRemoteCount(remoteTracksRef.current.size);
    });

    return () => {
      leave();
      try { client.removeAllListeners(); } catch {}
    };
  }, [channelName]);

  const setupLevelMeter = useCallback((stream: MediaStream) => {
    try {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      analyserRef.current = audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      srcNodeRef.current = audioCtxRef.current.createMediaStreamSource(stream);
      srcNodeRef.current.connect(analyserRef.current);
      const data = new Uint8Array(analyserRef.current.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {}
  }, []);

  const join = useCallback(async () => {
    if (!clientRef.current) return;
    try {
      setStatus("Connecting");
      const res = await fetch("/api/voice/agora-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: channelName, uid: "0" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "token_error");
      const { appId, token, channel, uid } = data;

      const client = clientRef.current;
      const joinUid = typeof uid === "number" ? uid : (uid === "0" ? 0 : uid);
      await client.join(appId, channel, token || null, joinUid as any);
      const track = await AgoraRTC.createMicrophoneAudioTrack({
        AEC: true,
        ANS: true,
        AGC: true,
        encoderConfig: "speech_low_quality",
      });
      localTrackRef.current = track;
      await client.publish([track]);

      const localStream = new MediaStream([track.getMediaStreamTrack()]);
      setupLevelMeter(localStream);
      setStatus("Connected");
      setJoined(true);
    } catch (e) {
      setStatus("Error");
    }
  }, [channelName, setupLevelMeter]);

  useEffect(() => {
    if (autoJoinDefault) {
      const t = setTimeout(() => { join().catch(() => {}); }, 150);
      return () => clearTimeout(t);
    }
  }, [autoJoinDefault, join]);

  const leave = useCallback(async () => {
    try {
      if (localTrackRef.current) {
        try { await localTrackRef.current.setEnabled(false); } catch {}
        try { localTrackRef.current.stop(); } catch {}
        try { localTrackRef.current.close(); } catch {}
      }
      localTrackRef.current = null;
      audioElsRef.current.forEach((el) => { try { el.srcObject = null; } catch {} });
      audioElsRef.current.clear();
      remoteTracksRef.current.clear();
      if (clientRef.current) {
        try { await clientRef.current.leave(); } catch {}
      }
    } finally {
      setJoined(false);
      setMuted(false);
      setDeafened(false);
      setStatus("Ready");
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      try { await audioCtxRef.current?.close(); } catch {}
      analyserRef.current = null;
      audioCtxRef.current = null;
      srcNodeRef.current = null;
    }
  }, []);

  const toggleMute = useCallback(async () => {
    if (!localTrackRef.current) return;
    try {
      const next = !muted;
      await localTrackRef.current.setEnabled(!muted);
      setMuted(next);
    } catch {}
  }, [muted]);

  const toggleDeafen = useCallback(() => {
    setDeafened((d) => {
      const next = !d;
      audioElsRef.current.forEach((el) => { el.muted = next; });
      return next;
    });
  }, []);

  const statusColor = status === "Connected" ? "bg-emerald-500" : status === "Ready" ? "bg-amber-400" : status === "Error" ? "bg-rose-500" : "bg-zinc-500";

  return (
    <div className="inline-flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
      <span className="text-sm font-medium text-white/90">{channelName}</span>
      <span className="px-1.5 py-0.5 rounded text-[10px] border border-white/15 text-white/80">{status}</span>
      <span className="inline-flex items-center gap-1 text-[11px] text-white/70" title="Participants">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="opacity-80"><path d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3Z" fill="currentColor"/><path d="M6 13c-2.21 0-4 1.79-4 4v2h8v-2c0-2.21-1.79-4-4-4Z" fill="currentColor"/><path d="M18 13c-1.86 0-3.41 1.28-3.86 3h7.72c-.45-1.72-2-3-3.86-3Z" fill="currentColor"/></svg>
        <span className="tabular-nums text-white/90 text-sm">{(joined ? 1 : 0) + remoteCount}</span>
      </span>
      <div className="h-[2px] w-24 bg-white/15 rounded overflow-hidden">
        <div className="h-full bg-emerald-500 transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%`, opacity: joined ? 1 : 0.2 }} />
      </div>
      {!joined ? (
        <button onClick={join} title="Join" className="h-8 px-2 inline-flex items-center justify-center gap-1 rounded-md bg-white text-black hover:bg-white/90 border border-white/10">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1.003 1.003 0 011.01-.24c1.12.37 2.33.57 3.58.57.55 0 1 .45 1 1V21c0 .55-.45 1-1 1C10.07 22 2 13.93 2 3c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.46.57 3.59.11.33.03.7-.24 1l-2.21 2.2z"/></svg>
          <span className="text-sm font-medium">Join</span>
        </button>
      ) : (
        <div className="inline-flex items-center gap-1">
          <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'} className={`h-7 w-7 grid place-items-center rounded-md border ${muted ? "bg-rose-500/90 text-white border-rose-400" : "bg-white/10 text-white border-white/20 hover:bg-white/20"}`}>
            {muted ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a4 4 0 00-4 4v3.59l8.41 8.41A7.938 7.938 0 0012 21a8 8 0 01-8-8h2a6 6 0 006 6c1.09 0 2.11-.29 3-.8L7 9.2V7a5 5 0 0110 0v1h-2V7a3 3 0 00-3-3z"/><path d="M21 19.59L4.41 3 3 4.41 19.59 21 21 19.59z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a5 5 0 00-5 5v4a5 5 0 0010 0V6a5 5 0 00-5-5zm3 9a3 3 0 01-6 0V6a3 3 0 016 0v4z"/><path d="M19 11a7 7 0 01-14 0H3a9 9 0 0018 0h-2z"/></svg>
            )}
          </button>
          <button onClick={toggleDeafen} title={deafened ? 'Undeafen' : 'Deafen'} className={`h-7 w-7 grid place-items-center rounded-md border ${deafened ? "bg-amber-500/90 text-black border-amber-400" : "bg-white/10 text-white border-white/20 hover:bg-white/20"}`}>
            {deafened ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 00-9 9v4a3 3 0 003 3h2v-6H6v-1a6 6 0 0110.59-3.41l1.45-1.45A8.96 8.96 0 0012 3z"/><path d="M4.41 3L3 4.41 7.59 9H7v6h2v4h6v-4h2a3 3 0 002.24-4.97L20 9.79 4.41 3z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 00-9 9v4a3 3 0 003 3h2v-6H6v-1a6 6 0 0112 0v1h-2v6h2a3 3 0 003-3v-4a9 9 0 00-9-9z"/></svg>
            )}
          </button>
          <button onClick={leave} title="Leave" className="h-7 w-7 grid place-items-center rounded-md bg-rose-500/90 text-white hover:bg-rose-500">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16.5l-5-5v3H8v4h8v3l5-5zM2 5h10v4H2z"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}


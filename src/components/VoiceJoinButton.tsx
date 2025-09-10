"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

// Always use Agora voice chat
const VoiceUI = dynamic(() => import("./VoiceChatAgora"), { ssr: false });

export default function VoiceJoinButton({ market }: { market: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { /* no dropdown anymore */ }, []);

  return (
    <div className="relative" ref={ref}>
      <VoiceUI market={market} />
    </div>
  );
}


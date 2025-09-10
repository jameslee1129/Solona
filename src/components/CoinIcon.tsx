"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  symbol: string;
  size?: number;
  className?: string;
};

export default function CoinIcon({ symbol, size = 18, className = "" }: Props) {
  const [sourceIdx, setSourceIdx] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const initials = useMemo(() => symbol.slice(0, 1).toUpperCase(), [symbol]);

  const sources = useMemo(() => {
    const s = symbol.toLowerCase();
    return [
      // 1) Local override (you can drop files into public/coins)
      `/coins/${s}.svg`,
      `/coins/${s}.png`,
      // 2) spothq (widely used, real coin logos)
      `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/${s}.svg`,
      // 3) CoinCap static
      `https://assets.coincap.io/assets/icons/${s}@2x.png`,
      // 4) Fallback generic
      `https://cryptoicons.org/api/icon/${s}/64`,
    ];
  }, [symbol]);

  const currentSrc = sources[sourceIdx];

  // If the first source has already failed to load before hydration,
  // React's onError won't fire. After hydration, detect a broken image
  // and advance to the next source.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    // If the image finished loading but has no intrinsic size, it failed
    if (img.complete && img.naturalWidth === 0 && sourceIdx < sources.length - 1) {
      setSourceIdx((i) => i + 1);
    }
  }, [currentSrc, sourceIdx, sources.length]);

  if (sourceIdx < sources.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={currentSrc}
        alt={`${symbol} icon`}
        width={size}
        height={size}
        className={`rounded-full ${className}`}
        onError={() => setSourceIdx((i) => i + 1)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full bg-gradient-to-br from-white/20 to-white/5 text-white/90 grid place-items-center text-[10px] font-semibold ${className}`}
      aria-label={`${symbol} icon`}
    >
      {initials}
    </div>
  );
}


"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, UTCTimestamp, CandlestickData } from "lightweight-charts";
import type { DemoOrder } from "@/components/TradingPanel";

export default function CandleChart({ candles, coin, positions }: { candles: { time: number; open: number; high: number; low: number; close: number; volume?: number }[]; coin?: string; positions?: DemoOrder[] }) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<any>(null);
  const initializedRef = useRef(false);
  const lastCoinRef = useRef<string | null>(null);
  const priceLinesRef = useRef<Map<string, { tp?: any; sl?: any }>>(new Map());
  const markerInfoRef = useRef<Map<number, string>>(new Map());
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#d1d5db",
        fontSize: 11,
      },
      rightPriceScale: {
        borderVisible: true,
        scaleMargins: { top: 0.05, bottom: 0.05 },
        entireTextOnly: false,
        alignLabels: true,
        mode: 0, // Normal mode
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: true,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
        barSpacing: 12,
        minBarSpacing: 4,
        rightOffset: 10,
        lockVisibleTimeRangeOnResize: true,
      },
      grid: {
        vertLines: { color: "#1f2937", style: 1 },
        horzLines: { color: "#1f2937", style: 1 },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#6b7280",
          width: 1,
          style: 3,
        },
        horzLine: {
          color: "#6b7280",
          width: 1,
          style: 3,
        },
      },
      autoSize: true,
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#065f46", // darker green to match order book heat
      downColor: "#7f1d1d", // darker red to match order book heat
      borderUpColor: "#10b981",
      borderDownColor: "#f43f5e",
      wickUpColor: "#10b981",
      wickDownColor: "#f43f5e",
      priceFormat: {
        type: 'price',
        precision: 6,
        minMove: 0.000001,
      },
      borderVisible: true,
      wickVisible: true,
    });
    
    // Add volume series if volume data is available
    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });
    
    chartRef.current = chart;
    seriesRef.current = series;
    
    // Function to remove TradingView watermarks and links
    const removeTradingViewElements = () => {
      if (containerRef.current) {
        // Remove any TradingView links
        const tvLinks = containerRef.current.querySelectorAll('a[href*="tradingview"], a[href*="TradingView"]');
        tvLinks.forEach(link => {
          const htmlLink = link as HTMLElement;
          htmlLink.style.display = 'none';
          htmlLink.style.visibility = 'hidden';
          htmlLink.remove();
        });
        
        // Remove watermarks and logos
        const watermarks = containerRef.current.querySelectorAll('[class*="watermark"], [class*="logo"], [class*="attribution"], .tv-attribution, .tv-logo, .tv-watermark');
        watermarks.forEach(element => {
          const htmlElement = element as HTMLElement;
          htmlElement.style.display = 'none';
          htmlElement.style.visibility = 'hidden';
          htmlElement.remove();
        });
        
        // Remove any remaining anchor tags
        const allLinks = containerRef.current.querySelectorAll('a');
        allLinks.forEach(link => {
          const htmlLink = link as HTMLElement;
          htmlLink.style.display = 'none';
          htmlLink.style.visibility = 'hidden';
          htmlLink.remove();
        });
      }
    };
    
    // Remove TradingView elements immediately and periodically
    removeTradingViewElements();
    const cleanupInterval = setInterval(removeTradingViewElements, 1000);
    
    const resize = () => {
      chart.applyOptions({});
      // Refit content when resizing
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.timeScale().fitContent();
        }
        // Clean up TradingView elements after resize
        removeTradingViewElements();
      }, 100);
    };
    
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      clearInterval(cleanupInterval);
      chart.remove();
      // Fjern alle prislinsjer ved unmount
      try {
        priceLinesRef.current.forEach((lines) => {
          if (seriesRef.current) {
            if (lines.tp) seriesRef.current.removePriceLine(lines.tp);
            if (lines.sl) seriesRef.current.removePriceLine(lines.sl);
          }
        });
        priceLinesRef.current.clear();
      } catch {}
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    
    // Check if we switched to a different coin - if so, reset everything
    const coinChanged = coin !== lastCoinRef.current;
    if (coinChanged) {
      //console.log(`CandleChart: Coin changed from ${lastCoinRef.current} to ${coin}, resetting chart`);
      lastCoinRef.current = coin || null;
      initializedRef.current = false;
      
      // Clear existing data immediately
      if (seriesRef.current) {
        try {
          seriesRef.current.setData([]);
          // Fjern alle prislinsjer ved coinskifte
          priceLinesRef.current.forEach((lines) => {
            if (lines.tp) seriesRef.current.removePriceLine(lines.tp);
            if (lines.sl) seriesRef.current.removePriceLine(lines.sl);
          });
          priceLinesRef.current.clear();
        } catch (e) {
          //console.log('Error clearing chart data:', e);
        }
      }
    }
    
    if (!candles || candles.length === 0) {
      if (coinChanged) {
        //console.log('CandleChart: No candles for new coin, waiting...');
      }
      return;
    }
    
    //console.log(`CandleChart: Processing ${candles.length} candles for ${coin}`);

    // Sorter og de-duper på tid i tilfelle out-of-order updates
    const sorted = [...candles]
      .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
      .sort((a, b) => a.time - b.time);
    
    if (sorted.length === 0) {
      //console.log('CandleChart: No valid candles after filtering');
      return;
    }
    
    //console.log('CandleChart: Filtered and sorted candles:', sorted.length);

    const normalized: CandlestickData[] = sorted.map((c) => {
      // Ensure time is a proper timestamp in seconds
      let timeInSeconds: number;
      if (typeof c.time === 'object' && c.time !== null) {
        // If time is an object, try to extract timestamp
        timeInSeconds = Math.floor((c.time as any).timestamp || (c.time as any).time || Date.now()) / 1000;
      } else if (typeof c.time === 'number') {
        // If it's already a number, check if it's in milliseconds or seconds
        timeInSeconds = c.time > 1e12 ? Math.floor(c.time / 1000) : c.time;
      } else {
        // Fallback to current time
        timeInSeconds = Math.floor(Date.now() / 1000);
      }
      
      return {
        time: timeInSeconds as UTCTimestamp,
        open: Number(c.open) || 0,
        high: Number(c.high) || Number(c.open) || 0,
        low: Number(c.low) || Number(c.open) || 0,
        close: Number(c.close) || 0,
      };
    });

    // Deduper og sikrer strengt stigende tid (lightweight-charts krever strictly increasing)
    const deduped: CandlestickData[] = [];
    let lastTs: number | null = null;
    for (const bar of normalized) {
      const t = bar.time as number;
      if (lastTs === null || t > lastTs) {
        deduped.push(bar);
        lastTs = t;
      } else if (t === lastTs) {
        // Erstatt siste bar hvis samme sekund forekommer flere ganger
        deduped[deduped.length - 1] = bar;
      } // hvis t < lastTs ignorerer vi (skal ikke skje etter sortering)
    }

    // Always use setData for new coins or when not initialized
    if (!initializedRef.current || coinChanged) {
      //console.log('CandleChart: Setting initial data for', coin);
      try {
        seriesRef.current.setData(deduped);
        initializedRef.current = true;
        
        // Fit content with padding for better view
        setTimeout(() => {
            if (chartRef.current && deduped.length > 0) {
            chartRef.current.timeScale().fitContent();
            
            // Adjust visible range based on chart size and dataset size
              if (deduped.length > 50) {
               const lastTime = deduped[deduped.length - 1].time;
              let candlesToShow = 100; // Default
              
              // Show more candles in expanded/fullscreen modes, but handle massive datasets intelligently
               if (isFullscreen) {
                 candlesToShow = Math.min(deduped.length, deduped.length > 5000 ? 500 : 300);
              } else if (isExpanded) {
                 candlesToShow = Math.min(deduped.length, deduped.length > 3000 ? 300 : 200);
              } else {
                 // For normal mode with massive datasets, show a reasonable amount
                 candlesToShow = Math.min(deduped.length, deduped.length > 1000 ? 150 : 100);
              }
              
               const startIndex = Math.max(0, deduped.length - candlesToShow);
               const startTime = deduped[startIndex].time;
              chartRef.current.timeScale().setVisibleRange({ from: startTime, to: lastTime });
              
               //console.log(`📊 Chart initialized with ${candlesToShow} visible candles out of ${deduped.length} total candles`);
            }
          }
        }, 150);
      } catch (e) {
        //console.error('Error setting chart data:', e);
      }
      return;
    }

    // For live updates on the same coin, only update the last candle if it changed
    if (deduped.length > 0) {
      const last = deduped[deduped.length - 1];
      try {
        //console.log('CandleChart: Updating with last candle:', {
          time: last.time,
          timeType: typeof last.time,
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close
        });
        seriesRef.current.update(last);
      } catch (e) {
        //console.error('Error updating chart:', e);
        //console.error('Last candle that failed:', last);
        // Fallback: reset and use setData
        //console.log('CandleChart: Fallback to setData');
        seriesRef.current.setData(deduped);
      }
    }
  }, [candles, coin]);

  // Marker entries (buys/sells) på chartet
  useEffect(() => {
    if (!seriesRef.current) return;
    const list = Array.isArray(positions) ? positions : [];
    const currentCoin = coin?.toUpperCase();
    const relevant = list.filter((p) => p && p.symbol?.toUpperCase() === currentCoin && p.orderRole === 'entry');
    if (relevant.length === 0) {
      try { seriesRef.current.setMarkers([]); } catch {}
      markerInfoRef.current.clear();
      return;
    }
    // Finn nærmeste candle-tid for hver ordre-timestamp
    const candleTimesMs = candles.map((c) => (typeof c.time === 'number' ? c.time : Date.now())).sort((a, b) => a - b);
    const toSeconds = (ms: number) => (ms > 1e12 ? Math.floor(ms / 1000) : ms) as UTCTimestamp;
    const findBucketSec = (tsMs: number): UTCTimestamp => {
      // binær-søk siste candle <= ts
      let lo = 0, hi = candleTimesMs.length - 1, ans = candleTimesMs[hi] ?? tsMs;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = candleTimesMs[mid];
        if (t <= tsMs) { ans = t; lo = mid + 1; } else { hi = mid - 1; }
      }
      return toSeconds(ans);
    };
    const markers = relevant.map((p) => {
      const time = findBucketSec(p.ts);
      const isLong = p.side === 'long';
      const label = isLong ? 'L' : 'S';
      const sizeStr = p.sizeUsd ? `${Math.round(p.sizeUsd).toLocaleString('nb-NO')} USD` : '';
      const levStr = p.leverage ? `x${p.leverage}` : '';
      const priceStr = p.price ? `${p.price.toLocaleString('nb-NO')}` : '';
      const info = `${isLong ? 'Long' : 'Short'} ${sizeStr}${levStr ? ' ' + levStr : ''}${priceStr ? ` @ ${priceStr}` : ''}`;
      markerInfoRef.current.set(time as unknown as number, info);
      return {
        time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#10b981' : '#f43f5e',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: label,
      } as const;
    });
    try {
      seriesRef.current.setMarkers(markers);
    } catch {}
  }, [positions, candles, coin]);

  // Tegn TP/SL prislinsjer + trailing (estimat) når scenario (groupId) finnes
  useEffect(() => {
    if (!seriesRef.current) return;
    const list = Array.isArray(positions) ? positions : [];
    const currentCoin = coin?.toUpperCase();
    const scoped = list.filter((p) => p && p.symbol?.toUpperCase() === currentCoin && (p.orderRole === 'tp' || p.orderRole === 'sl' || p.orderRole === 'trailing') && p.groupId);
    // groupId -> { tp?: number, sl?: number, trail?: number }
    const desired = new Map<string, { tp?: number; sl?: number; trail?: number }>();
    for (const o of scoped) {
      const gid = o.groupId as string;
      const cur = desired.get(gid) || {} as { tp?: number; sl?: number; trail?: number };
      if (o.orderRole === 'tp' && Number.isFinite(o.price)) cur.tp = o.price as number;
      if (o.orderRole === 'sl' && Number.isFinite(o.price)) cur.sl = o.price as number;
      if (o.orderRole === 'trailing' && o.trailing) {
        // Estimer trailing-stop rundt siste pris
        const lastClose = candles?.length ? Number(candles[candles.length - 1].close) : undefined;
        if (Number.isFinite(lastClose)) {
          const isLongGroup = list.find((p) => p.groupId === gid && p.orderRole === 'entry')?.side === 'long';
          const mode = o.trailing.mode;
          const val = o.trailing.value;
          if (mode === 'percent') {
            const pct = Number(val) / 100;
            cur.trail = lastClose! * (isLongGroup ? (1 - pct) : (1 + pct));
          } else {
            cur.trail = isLongGroup ? (lastClose! - Number(val)) : (lastClose! + Number(val));
          }
        }
      }
      desired.set(gid, cur);
    }
    // Opprett/oppdater linjer
    desired.forEach((vals, gid) => {
      let entry = priceLinesRef.current.get(gid) as { tp?: any; sl?: any; trail?: any } | undefined;
      if (!entry) { entry = {}; priceLinesRef.current.set(gid, entry as any); }
      if (vals.tp !== undefined) {
        if (entry.tp) {
          try { entry.tp.applyOptions({ price: vals.tp }); } catch {}
        } else {
          try {
            entry.tp = seriesRef.current.createPriceLine({
              price: vals.tp,
              color: '#22c55e',
              lineStyle: 2,
              lineWidth: 1,
              axisLabelVisible: true,
              title: 'TP',
            });
          } catch {}
        }
      }
      if (vals.sl !== undefined) {
        if (entry.sl) {
          try { entry.sl.applyOptions({ price: vals.sl }); } catch {}
        } else {
          try {
            entry.sl = seriesRef.current.createPriceLine({
              price: vals.sl,
              color: '#ef4444',
              lineStyle: 2,
              lineWidth: 1,
              axisLabelVisible: true,
              title: 'SL',
            });
          } catch {}
        }
      }
      if (vals.trail !== undefined) {
        if (entry.trail) {
          try { entry.trail.applyOptions({ price: vals.trail }); } catch {}
        } else {
          try {
            entry.trail = seriesRef.current.createPriceLine({
              price: vals.trail,
              color: '#a78bfa',
              lineStyle: 1,
              lineWidth: 1,
              axisLabelVisible: true,
              title: 'TRAIL',
            });
          } catch {}
        }
      }
      priceLinesRef.current.set(gid, entry as any);
    });
    // Fjern linjer for grupper som ikke lenger finnes
    priceLinesRef.current.forEach((lines: any, gid) => {
      if (!desired.has(gid)) {
        try {
          if (lines.tp) seriesRef.current.removePriceLine(lines.tp);
          if (lines.sl) seriesRef.current.removePriceLine(lines.sl);
          if (lines.trail) seriesRef.current.removePriceLine(lines.trail);
        } catch {}
        priceLinesRef.current.delete(gid);
      } else {
        // Dersom ønsket ikke inneholder tp/sl lenger, fjern de spesifikke
        const want = desired.get(gid)!;
        if (!('tp' in want) && lines.tp) { try { seriesRef.current.removePriceLine(lines.tp); } catch {} lines.tp = undefined; }
        if (!('sl' in want) && lines.sl) { try { seriesRef.current.removePriceLine(lines.sl); } catch {} lines.sl = undefined; }
        if (!('trail' in want) && lines.trail) { try { seriesRef.current.removePriceLine(lines.trail); } catch {} lines.trail = undefined; }
      }
    });
  }, [positions, coin]);

  // Opprett enkel hover-tooltip for markører via crosshair
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    // Lag tooltip container en gang
    if (!tooltipRef.current) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.pointerEvents = 'none';
      el.style.background = 'rgba(0,0,0,0.9)';
      el.style.color = '#fff';
      el.style.padding = '6px 8px';
      el.style.fontSize = '11px';
      el.style.border = '1px solid rgba(255,255,255,0.15)';
      el.style.borderRadius = '6px';
      el.style.boxShadow = '0 2px 10px rgba(0,0,0,0.4)';
      el.style.whiteSpace = 'nowrap';
      el.style.zIndex = '20';
      el.style.display = 'none';
      container.appendChild(el);
      tooltipRef.current = el;
    }
    const onMove = (param: any) => {
      const tip = tooltipRef.current!;
      if (!param?.time || !param?.point) {
        tip.style.display = 'none';
        return;
      }
      const t = param.time as number;
      const info = markerInfoRef.current.get(t);
      if (!info) {
        tip.style.display = 'none';
        return;
      }
      tip.textContent = info;
      const x = param.point.x + 10;
      const y = param.point.y - 10;
      tip.style.left = `${Math.max(8, Math.min(x, container.clientWidth - tip.clientWidth - 8))}px`;
      tip.style.top = `${Math.max(8, Math.min(y, container.clientHeight - tip.clientHeight - 8))}px`;
      tip.style.display = 'block';
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      try { chart.unsubscribeCrosshairMove(onMove); } catch {}
      if (tooltipRef.current && tooltipRef.current.parentElement === container) {
        try { container.removeChild(tooltipRef.current); } catch {}
        tooltipRef.current = null;
      }
    };
  }, []);

  // Handle chart resize when expanded/fullscreen state changes
  useEffect(() => {
    if (chartRef.current) {
      // Trigger resize after a short delay to allow CSS transitions to complete
      setTimeout(() => {
        if (chartRef.current) {
          chartRef.current.applyOptions({});
          chartRef.current.timeScale().fitContent();
        }
      }, 300);
    }
  }, [isExpanded, isFullscreen]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // ESC to exit fullscreen or expanded mode
      if (e.key === 'Escape') {
        if (isFullscreen) {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          }
        } else if (isExpanded) {
          setIsExpanded(false);
        }
      }
      // F11 or F to toggle fullscreen
      if (e.key === 'F11' || (e.key === 'f' && e.ctrlKey)) {
        e.preventDefault();
        toggleFullscreen();
      }
      // E to toggle expanded mode
      if (e.key === 'e' && e.ctrlKey) {
        e.preventDefault();
        setIsExpanded(!isExpanded);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, isFullscreen]);

  const getChartHeight = () => {
    if (isFullscreen) return 'h-screen';
    if (isExpanded) return 'h-[800px]';
    return 'h-full';
  };

  const getContainerClasses = () => {
    let classes = "relative w-full group transition-all duration-300 ";
    if (isFullscreen) {
      classes += "fixed inset-0 z-50 bg-black ";
    } else if (isExpanded) {
      classes += "h-[800px] ";
    } else {
      classes += "h-full ";
    }
    return classes;
  };

  return (
    <div className={getContainerClasses()}>
      <div 
        ref={containerRef} 
        className={`w-full ${getChartHeight()} bg-black ${isFullscreen ? '' : 'rounded-lg'}`}
        style={{
          // Hide TradingView watermark and links
          position: 'relative'
        }}
      />
      
      {/* Chart overlay controls removed per request */}
    </div>
  );
}


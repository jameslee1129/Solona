"use client";

import { useEffect, useRef, useState } from "react";

interface TradingViewChartProps {
  symbol: string;
  timeframe: string;
  onTimeframeChange?: (timeframe: string) => void;
  tpPrice?: number;
  slPrice?: number;
}

export default function TradingViewChart({ symbol, timeframe, onTimeframeChange, tpPrice, slPrice }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const containerIdRef = useRef<string>(`tvw_${Math.random().toString(36).slice(2)}`);
  const [isLoading, setIsLoading] = useState(true);

  // Map internal timeframes to TradingView intervals
  const mapTimeframeToTradingView = (tf: string): string => {
    const mapping: Record<string, string> = {
      '1m': '1',
      '5m': '5', 
      '15m': '15',
      '1h': '60',
      '4h': '240',
      '1d': '1D'
    };
    return mapping[tf] || '60';
  };

  // Convert symbol to TradingView format
  const formatSymbolForTradingView = (sym: string): string => {
    return `BYBIT:${sym}USDT`;
  };

  // Add TP/SL lines to TradingView chart (simple overlay approach)
  useEffect(() => {
    try {
      const container = containerRef.current;
      if (!container) return;

      container.querySelectorAll('.tp-sl-line').forEach(el => el.remove());

      if (tpPrice) {
        const tpLine = document.createElement('div');
        tpLine.className = 'tp-sl-line tp-line';
        tpLine.style.cssText = `
          position: absolute;
          top: 20%;
          left: 0;
          right: 0;
          height: 2px;
          background-color: #22c55e;
          z-index: 1000;
          pointer-events: none;
        `;

        const tpLabel = document.createElement('div');
        tpLabel.textContent = `TP: $${tpPrice.toFixed(2)}`;
        tpLabel.style.cssText = `
          position: absolute;
          right: 10px;
          top: -20px;
          background: #22c55e;
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        `;

        tpLine.appendChild(tpLabel);
        container.appendChild(tpLine);
      }

      if (slPrice) {
        const slLine = document.createElement('div');
        slLine.className = 'tp-sl-line sl-line';
        slLine.style.cssText = `
          position: absolute;
          top: 80%;
          left: 0;
          right: 0;
          height: 2px;
          background-color: #ef4444;
          z-index: 1000;
          pointer-events: none;
        `;

        const slLabel = document.createElement('div');
        slLabel.textContent = `SL: $${slPrice.toFixed(2)}`;
        slLabel.style.cssText = `
          position: absolute;
          right: 10px;
          top: -20px;
          background: #ef4444;
          color: white;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        `;

        slLine.appendChild(slLabel);
        container.appendChild(slLine);
      }
    } catch (error) {
      // Ignore TP/SL line errors
    }
  }, [tpPrice, slPrice]);

  useEffect(() => {
    if (!containerRef.current) return;

    setIsLoading(true);

    const tvSymbol = formatSymbolForTradingView(symbol);
    const interval = mapTimeframeToTradingView(timeframe);
    
    // Create TradingView widget configuration with advanced features
    const widgetConfig = {
      "width": "100%",
      "height": "100%",
      "symbol": tvSymbol,
      "interval": interval,
      "timezone": "Etc/UTC",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "toolbar_bg": "#000000",
      "enable_publishing": false,
      "backgroundColor": "#000000",
      "gridColor": "#1f2937",
      "hide_top_toolbar": false,
      "hide_legend": false,
      "save_image": false,
      "container_id": containerIdRef.current,
      "custom_css_url": "/tradingview-custom.css",
      "autosize": true,
      "studies": [],
      "show_popup_button": false,
      "popup_width": "1000",
      "popup_height": "650",
      "overrides": {
        "paneProperties.background": "#000000",
        "paneProperties.backgroundType": "solid",
        "paneProperties.vertGridProperties.color": "#1f2937",
        "paneProperties.horzGridProperties.color": "#1f2937",
        "symbolWatermarkProperties.transparency": 90,
        "scalesProperties.textColor": "#9ca3af",
        "scalesProperties.backgroundColor": "#000000",
        "scalesProperties.lineColor": "#000000",
        "mainSeriesProperties.candleStyle.upColor": "#10b981",
        "mainSeriesProperties.candleStyle.downColor": "#ef4444",
        "mainSeriesProperties.candleStyle.borderUpColor": "#10b981",
        "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
        "mainSeriesProperties.candleStyle.wickUpColor": "#10b981",
        "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
        "paneProperties.topMargin": 0,
        "paneProperties.bottomMargin": 0
      }
    };

    // Clear container first
    containerRef.current.innerHTML = '';

    // Create the widget container
    const widgetContainer = document.createElement('div');
    widgetContainer.className = 'tradingview-widget-container';
    widgetContainer.style.height = '100%';
    widgetContainer.style.width = '100%';

    // Create the widget div
    const widgetDiv = document.createElement('div');
    widgetDiv.className = 'tradingview-widget-container__widget';
    widgetDiv.id = containerIdRef.current;
    widgetDiv.style.height = '100%';
    widgetDiv.style.width = '100%';

    // Add widget ready callback to configuration
    const widgetConfigWithCallback = {
      ...widgetConfig,
      onChartReady: () => {
        setIsLoading(false);
      }
    };

    // Create the script tag with configuration
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify(widgetConfigWithCallback);

    // Skip copyright div to remove TradingView branding

    // Assemble the widget
    widgetContainer.appendChild(widgetDiv);
    widgetContainer.appendChild(script);

    // Add to container
    containerRef.current.appendChild(widgetContainer);

    // Detect when iframe has been created and loaded to end loading state
    const observer = new MutationObserver(() => {
      const iframe = widgetContainer.querySelector('iframe');
      if (iframe) {
        iframe.addEventListener('load', () => setIsLoading(false), { once: true });
        // Fallback in case 'load' doesn't fire as expected
        const fallback = setTimeout(() => setIsLoading(false), 3000);
        iframe.addEventListener('load', () => clearTimeout(fallback), { once: true });
        observer.disconnect();
      }
    });
    observer.observe(widgetContainer, { childList: true, subtree: true });

    return () => {
      try {
        observer.disconnect();
      } catch {}
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, timeframe]);

  return (
    <div className="relative w-full h-full bg-black rounded-md overflow-hidden">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black z-10 rounded-md">
          <div className="text-white/70 text-sm">Loading TradingView Chart...</div>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full min-h-[400px] rounded-md"
        style={{ height: '100%' }}
      />
    </div>
  );
}
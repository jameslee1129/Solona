import { useState, useEffect, useRef, useCallback } from 'react';

interface Position {
  coin: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  unrealizedPnl: number;
  leverage: number;
  marginUsed: number;
  maxLeverage: number;
}

interface PositionUpdate {
  type: 'position_opened' | 'position_closed' | 'position_updated' | 'liquidation';
  position?: Position;
  previousPosition?: Position;
  pnlChange?: number;
  liquidationReason?: string;
  timestamp: number;
}

interface UsePositionMonitoringReturn {
  positions: Position[];
  isConnected: boolean;
  lastUpdate: number | null;
  notifications: PositionUpdate[];
  clearNotifications: () => void;
  requestNotificationPermission: () => Promise<boolean>;
}

// Helper function to compare positions
const arePositionsEqual = (pos1: Position, pos2: Position): boolean => {
  return pos1.coin === pos2.coin &&
         pos1.side === pos2.side &&
         pos1.size === pos2.size &&
         pos1.entryPrice === pos2.entryPrice &&
         pos1.unrealizedPnl === pos2.unrealizedPnl &&
         pos1.leverage === pos2.leverage &&
         pos1.marginUsed === pos2.marginUsed &&
         pos1.maxLeverage === pos2.maxLeverage;
};

// Helper function to compare position arrays
const arePositionArraysEqual = (arr1: Position[], arr2: Position[]): boolean => {
  if (arr1.length !== arr2.length) return false;
  return arr1.every((pos1, index) => arePositionsEqual(pos1, arr2[index]));
};

export function usePositionMonitoring(userId: string | null): UsePositionMonitoringReturn {
  const [positions, setPositions] = useState<Position[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<PositionUpdate[]>([]);
  
  const previousPositionsRef = useRef<Position[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const notificationPermissionRef = useRef<NotificationPermission>('default');
  const rateLimitCountRef = useRef(0);

  // Request notification permission
  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }

    if (Notification.permission === 'granted') {
      notificationPermissionRef.current = 'granted';
      return true;
    }

    if (Notification.permission === 'denied') {
      notificationPermissionRef.current = 'denied';
      return false;
    }

    const permission = await Notification.requestPermission();
    notificationPermissionRef.current = permission;
    return permission === 'granted';
  }, []);

  // Show browser notification
  const showNotification = useCallback((title: string, options: NotificationOptions) => {
    if (notificationPermissionRef.current === 'granted') {
      new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options
      });
    }
  }, []);

  // Fetch positions from API
  const fetchPositions = useCallback(async (): Promise<Position[]> => {
    try {
      const response = await fetch('/api/trading/positions', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      const data = await response.json();
      
      // Handle no_custodial_wallet case (now returns 200 status)
      if (data.error === 'no_custodial_wallet') {
        // This is normal for new users who haven't created a custodial wallet yet
        console.log('No custodial wallet found - user may need to complete onboarding');
        return []; // Return empty positions array
      }
      
      if (!response.ok) {
        // Handle other error cases gracefully
        
        if (data.error === 'Invalid Hyperliquid wallet address') {
          console.warn('User needs to set up a valid EVM wallet for Hyperliquid trading');
          return []; // Return empty positions array
        }
        
        if (data.error === 'Rate limit exceeded') {
          console.warn('Rate limit exceeded - reducing polling frequency');
          rateLimitCountRef.current++;
          // If we hit rate limit multiple times, increase polling interval
          if (rateLimitCountRef.current > 2) {
            console.warn('Multiple rate limits hit - temporarily stopping polling');
            return [];
          }
        }
        return [];
      }
      
      // Reset rate limit counter on successful request
      rateLimitCountRef.current = 0;
      return data.positions || [];
    } catch (error) {
      console.error('Error fetching positions:', error);
      return [];
    }
  }, []);

  // Compare positions and detect changes
  const detectPositionChanges = useCallback((newPositions: Position[], previousPositions: Position[]): PositionUpdate[] => {
    const updates: PositionUpdate[] = [];
    const now = Date.now();

    // Create maps for easier comparison
    const newPositionsMap = new Map(newPositions.map(p => [p.coin, p]));
    const previousPositionsMap = new Map(previousPositions.map(p => [p.coin, p]));

    // Check for new positions
    for (const [coin, newPos] of newPositionsMap) {
      if (!previousPositionsMap.has(coin)) {
        updates.push({
          type: 'position_opened',
          position: newPos,
          timestamp: now
        });
      }
    }

    // Check for closed positions
    for (const [coin, prevPos] of previousPositionsMap) {
      if (!newPositionsMap.has(coin)) {
        updates.push({
          type: 'position_closed',
          position: prevPos,
          timestamp: now
        });
      }
    }

    // Check for updated positions
    for (const [coin, newPos] of newPositionsMap) {
      const prevPos = previousPositionsMap.get(coin);
      if (prevPos) {
        const pnlChange = newPos.unrealizedPnl - prevPos.unrealizedPnl;
        const sizeChange = Math.abs(newPos.size - prevPos.size);
        
        // Detect significant changes
        if (Math.abs(pnlChange) > 0.01 || sizeChange > 0.001) {
          updates.push({
            type: 'position_updated',
            position: newPos,
            previousPosition: prevPos,
            pnlChange,
            timestamp: now
          });
        }

        // Detect liquidation (position closed with significant loss)
        if (newPos.size === 0 && prevPos.size > 0 && prevPos.unrealizedPnl < -0.01) {
          updates.push({
            type: 'liquidation',
            position: prevPos,
            liquidationReason: 'Position liquidated due to insufficient margin',
            timestamp: now
          });
        }
      }
    }

    return updates;
  }, []);

  // Process position updates and show notifications
  const processPositionUpdates = useCallback((updates: PositionUpdate[]) => {
    for (const update of updates) {
      setNotifications(prev => [update, ...prev.slice(0, 49)]); // Keep last 50 notifications

      // Show browser notifications for important events
      switch (update.type) {
        case 'position_opened':
          showNotification(
            `Position Opened: ${update.position?.coin}`,
            {
              body: `${update.position?.side.toUpperCase()} ${update.position?.size} ${update.position?.coin} @ $${update.position?.entryPrice}`,
              tag: `position-${update.position?.coin}`
            }
          );
          break;

        case 'position_closed':
          showNotification(
            `Position Closed: ${update.position?.coin}`,
            {
              body: `Final PnL: $${update.position?.unrealizedPnl.toFixed(2)}`,
              tag: `position-${update.position?.coin}`
            }
          );
          break;

        case 'liquidation':
          showNotification(
            `🚨 LIQUIDATION ALERT: ${update.position?.coin}`,
            {
              body: `Position liquidated! Loss: $${update.position?.unrealizedPnl.toFixed(2)}`,
              tag: `liquidation-${update.position?.coin}`,
              requireInteraction: true
            }
          );
          break;

        case 'position_updated':
          if (update.pnlChange && Math.abs(update.pnlChange) > 10) {
            const isProfit = update.pnlChange > 0;
            showNotification(
              `${isProfit ? '📈' : '📉'} PnL Update: ${update.position?.coin}`,
              {
                body: `${isProfit ? 'Profit' : 'Loss'}: $${Math.abs(update.pnlChange).toFixed(2)}`,
                tag: `pnl-${update.position?.coin}`
              }
            );
          }
          break;
      }
    }
  }, [showNotification]);

  // Clear notifications
  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  // WebSocket connection for real-time updates
  const connectWebSocket = useCallback(() => {
    if (!userId || wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('Position monitoring WebSocket connected');
        setIsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Handle position updates from WebSocket
          if (data.type === 'position_update' && data.user === userId) {
            // Process real-time position data
            const newPositions = data.positions || [];
            const updates = detectPositionChanges(newPositions, previousPositionsRef.current);
            if (updates.length > 0) {
              setPositions(newPositions);
              processPositionUpdates(updates);
              setLastUpdate(Date.now());
              previousPositionsRef.current = newPositions;
            }
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      ws.onclose = () => {
        console.log('Position monitoring WebSocket disconnected');
        setIsConnected(false);
        
        // Attempt to reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          connectWebSocket();
        }, 5000);
      };

      ws.onerror = (error) => {
        console.error('Position monitoring WebSocket error:', error);
        setIsConnected(false);
      };

    } catch (error) {
      console.error('Failed to connect WebSocket:', error);
      setIsConnected(false);
    }
  }, [userId, detectPositionChanges, processPositionUpdates]);

  // Polling fallback when WebSocket is not available
  const startPolling = useCallback(() => {
    if (pollIntervalRef.current) return;

    const poll = async () => {
      try {
        const newPositions = await fetchPositions();
        
        // Only update if positions have actually changed
        if (!arePositionArraysEqual(newPositions, previousPositionsRef.current)) {
          const updates = detectPositionChanges(newPositions, previousPositionsRef.current);
          
          if (updates.length > 0) {
            setPositions(newPositions);
            processPositionUpdates(updates);
            setLastUpdate(Date.now());
          }
          
          previousPositionsRef.current = newPositions;
        }
      } catch (error) {
        console.error('Error polling positions:', error);
      }
    };

    // Initial fetch
    poll();
    
    // Poll every 15 seconds to avoid rate limiting
    pollIntervalRef.current = setInterval(poll, 15000);
  }, [fetchPositions, detectPositionChanges, processPositionUpdates]);

  // Main effect - only runs when userId changes
  useEffect(() => {
    if (!userId) {
      // Clean up when no user
      setPositions([]);
      setIsConnected(false);
      setLastUpdate(null);
      
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      return;
    }

    // Request notification permission on first load
    requestNotificationPermission();

    // Start WebSocket connection
    connectWebSocket();

    // Start polling as fallback
    startPolling();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [userId]); // Only depend on userId

  return {
    positions,
    isConnected,
    lastUpdate,
    notifications,
    clearNotifications,
    requestNotificationPermission
  };
}
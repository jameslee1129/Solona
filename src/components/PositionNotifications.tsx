"use client";

import React, { useState, useEffect } from 'react';
import { usePositionMonitoring } from '@/hooks/usePositionMonitoring';

interface PositionNotificationsProps {
  userId: string | null;
  className?: string;
}

interface NotificationItem {
  id: string;
  type: 'position_opened' | 'position_closed' | 'position_updated' | 'liquidation';
  title: string;
  message: string;
  timestamp: number;
  isRead: boolean;
  severity: 'info' | 'warning' | 'error' | 'success';
}

export default function PositionNotifications({ userId, className = '' }: PositionNotificationsProps) {
  const { notifications, isConnected, lastUpdate, clearNotifications, requestNotificationPermission } = usePositionMonitoring(userId);
  const [isOpen, setIsOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Convert position updates to notification items
  useEffect(() => {
    const items: NotificationItem[] = notifications.map((update, index) => {
      const id = `${update.type}-${update.timestamp}-${index}`;
      
      switch (update.type) {
        case 'position_opened':
          return {
            id,
            type: update.type,
            title: `Position Opened: ${update.position?.coin}`,
            message: `${update.position?.side?.toUpperCase()} ${update.position?.size} ${update.position?.coin} @ $${update.position?.entryPrice?.toFixed(2)}`,
            timestamp: update.timestamp,
            isRead: false,
            severity: 'info'
          };

        case 'position_closed':
          return {
            id,
            type: update.type,
            title: `Position Closed: ${update.position?.coin}`,
            message: `Final PnL: $${update.position?.unrealizedPnl?.toFixed(2)}`,
            timestamp: update.timestamp,
            isRead: false,
            severity: 'success'
          };

        case 'liquidation':
          return {
            id,
            type: update.type,
            title: `🚨 LIQUIDATION: ${update.position?.coin}`,
            message: `Position liquidated! Loss: $${update.position?.unrealizedPnl?.toFixed(2)}`,
            timestamp: update.timestamp,
            isRead: false,
            severity: 'error'
          };

        case 'position_updated':
          const isProfit = (update.pnlChange || 0) > 0;
          return {
            id,
            type: update.type,
            title: `${isProfit ? '📈' : '📉'} PnL Update: ${update.position?.coin}`,
            message: `${isProfit ? 'Profit' : 'Loss'}: $${Math.abs(update.pnlChange || 0).toFixed(2)}`,
            timestamp: update.timestamp,
            isRead: false,
            severity: isProfit ? 'success' : 'warning'
          };

        default:
          return {
            id,
            type: update.type,
            title: 'Position Update',
            message: 'Position data updated',
            timestamp: update.timestamp,
            isRead: false,
            severity: 'info'
          };
      }
    });

    setNotificationItems(prev => [...items, ...prev].slice(0, 50)); // Keep last 50 notifications
  }, [notifications]);

  // Update unread count
  useEffect(() => {
    const unread = notificationItems.filter(item => !item.isRead).length;
    setUnreadCount(unread);
  }, [notificationItems]);

  // Mark notification as read
  const markAsRead = (id: string) => {
    setNotificationItems(prev => 
      prev.map(item => 
        item.id === id ? { ...item, isRead: true } : item
      )
    );
  };

  // Mark all as read
  const markAllAsRead = () => {
    setNotificationItems(prev => 
      prev.map(item => ({ ...item, isRead: true }))
    );
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  // Get severity colors
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'error': return 'text-red-400 bg-red-900/20 border-red-500/30';
      case 'warning': return 'text-yellow-400 bg-yellow-900/20 border-yellow-500/30';
      case 'success': return 'text-green-400 bg-green-900/20 border-green-500/30';
      case 'info': return 'text-blue-400 bg-blue-900/20 border-blue-500/30';
      default: return 'text-gray-400 bg-gray-900/20 border-gray-500/30';
    }
  };

  // Get severity icon
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'error': return '🚨';
      case 'warning': return '⚠️';
      case 'success': return '✅';
      case 'info': return 'ℹ️';
      default: return '📢';
    }
  };

  if (!userId) return null;

  return (
    <div className={`relative ${className}`}>
      {/* Notification Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-white/70 hover:text-white transition-colors"
        title="Position Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-5 5v-5zM4 19h6v-6H4v6zM4 5h6V1H4v4zM15 5h5V1h-5v4z" />
        </svg>
        
        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full h-5 w-5 flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Connection Status */}
        <div className={`absolute -bottom-1 -right-1 w-2 h-2 rounded-full ${
          isConnected ? 'bg-green-500' : 'bg-red-500'
        }`} title={isConnected ? 'Connected' : 'Disconnected'} />
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <div className="absolute right-0 top-12 w-80 bg-black/95 backdrop-blur-sm border border-gray-700 rounded-lg shadow-xl z-50">
          {/* Header */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-medium">Position Notifications</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={markAllAsRead}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Mark all read
                </button>
                <button
                  onClick={clearNotifications}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Clear all
                </button>
              </div>
            </div>
            
            {/* Connection Status */}
            <div className="flex items-center gap-2 mt-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-400">
                {isConnected ? 'Live updates' : 'Polling mode'}
              </span>
              {lastUpdate && (
                <span className="text-gray-500">
                  • {formatTimestamp(lastUpdate)}
                </span>
              )}
            </div>
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {notificationItems.length === 0 ? (
              <div className="p-4 text-center text-gray-400 text-sm">
                No notifications yet
              </div>
            ) : (
              notificationItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => markAsRead(item.id)}
                  className={`p-3 border-b border-gray-800 hover:bg-gray-900/50 cursor-pointer transition-colors ${
                    !item.isRead ? 'bg-gray-900/30' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="text-lg">{getSeverityIcon(item.severity)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-white text-sm font-medium truncate">
                          {item.title}
                        </h4>
                        {!item.isRead && (
                          <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-gray-400 text-xs mt-1">{item.message}</p>
                      <p className="text-gray-500 text-xs mt-1">{formatTimestamp(item.timestamp)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-700">
            <button
              onClick={() => requestNotificationPermission()}
              className="w-full text-xs text-blue-400 hover:text-blue-300 text-center"
            >
              Enable browser notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useRef, useCallback } from 'react';
import toast from 'react-hot-toast';

interface ToastOptions {
  duration?: number;
  id?: string;
}

export const useDebouncedToast = () => {
  const lastToastRef = useRef<Map<string, number>>(new Map());
  const DEBOUNCE_TIME = 3000; // 3 seconds debounce

  const showSuccess = useCallback((message: string, options?: ToastOptions) => {
    const now = Date.now();
    const lastTime = lastToastRef.current.get(message);
    
    if (!lastTime || now - lastTime > DEBOUNCE_TIME) {
      toast.dismiss(); // Dismiss all existing toasts
      lastToastRef.current.set(message, now);
      toast.success(message, {
        duration: options?.duration || 2000,
        id: options?.id || message,
      });
    }
  }, []);

  const showError = useCallback((message: string, options?: ToastOptions) => {
    const now = Date.now();
    const lastTime = lastToastRef.current.get(message);
    
    if (!lastTime || now - lastTime > DEBOUNCE_TIME) {
      toast.dismiss(); // Dismiss all existing toasts
      lastToastRef.current.set(message, now);
      toast.error(message, {
        duration: options?.duration || 2000,
        id: options?.id || message,
      });
    }
  }, []);

  const showWarning = useCallback((message: string, options?: ToastOptions) => {
    const now = Date.now();
    const lastTime = lastToastRef.current.get(message);
    
    if (!lastTime || now - lastTime > DEBOUNCE_TIME) {
      toast.dismiss(); // Dismiss all existing toasts
      lastToastRef.current.set(message, now);
      toast(message, {
        icon: '⚠️',
        duration: options?.duration || 2000,
        id: options?.id || message,
        style: {
          background: '#F59E0B',
          color: '#fff',
        },
      });
    }
  }, []);

  const showInfo = useCallback((message: string, options?: ToastOptions) => {
    const now = Date.now();
    const lastTime = lastToastRef.current.get(message);
    
    if (!lastTime || now - lastTime > DEBOUNCE_TIME) {
      toast.dismiss(); // Dismiss all existing toasts
      lastToastRef.current.set(message, now);
      toast(message, {
        icon: 'ℹ️',
        duration: options?.duration || 2000,
        id: options?.id || message,
        style: {
          background: '#3B82F6',
          color: '#fff',
        },
      });
    }
  }, []);

  const showLoading = useCallback((message: string, options?: ToastOptions) => {
    const now = Date.now();
    const lastTime = lastToastRef.current.get(message);
    
    if (!lastTime || now - lastTime > DEBOUNCE_TIME) {
      toast.dismiss(); // Dismiss all existing toasts
      lastToastRef.current.set(message, now);
      return toast.loading(message, {
        duration: options?.duration || 2000,
        id: options?.id || message,
      });
    }
    return null;
  }, []);

  const dismiss = useCallback((toastId?: string) => {
    if (toastId) {
      toast.dismiss(toastId);
    } else {
      toast.dismiss();
    }
  }, []);

  return {
    showSuccess,
    showError,
    showWarning,
    showInfo,
    showLoading,
    dismiss,
  };
};

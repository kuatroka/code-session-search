import { useEffect, useRef, useCallback } from "react";

interface UseEventSourceOptions {
  onMessage: (event: MessageEvent) => void;
  onError?: () => void;
  eventName?: string;
  maxRetries?: number;
  baseDelay?: number;
}

export function useEventSource(url: string, options: UseEventSourceOptions) {
  const {
    onMessage,
    onError,
    eventName = "message",
    maxRetries = 10,
    baseDelay = 1000,
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) {
      return;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener(eventName, (event) => {
      retryCountRef.current = 0;
      onMessage(event);
    });

    eventSource.onerror = () => {
      eventSource.close();

      if (!mountedRef.current) {
        return;
      }

      if (retryCountRef.current < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, retryCountRef.current), 30000);
        retryCountRef.current++;

        retryTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        onError?.();
      }
    };
  }, [url, eventName, onMessage, onError, maxRetries, baseDelay]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;

      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [connect]);
}

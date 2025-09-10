"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type IntroSlide = {
  title: string;
  description: string;
  mediaSrc?: string;
  mediaAlt?: string;
};

type IntroModalProps = {
  slides: IntroSlide[];
  storageKey?: string;
  initialOpen?: boolean;
  onClose?: () => void;
};

/**
 * Dark, sleek intro modal with step navigation and progress dots.
 * Persists dismissal to localStorage so it only shows once.
 */
export default function IntroModal(props: IntroModalProps) {
  const { slides, onClose, storageKey = "intro_modal_v1", initialOpen } = props;

  const [hasMounted, setHasMounted] = useState(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeIndex, setActiveIndex] = useState<number>(0);

  // Mount-only: decide whether to show, based on localStorage
  useEffect(() => {
    setHasMounted(true);
    try {
      const dismissed = localStorage.getItem(storageKey) === "1";
      setIsOpen(initialOpen ?? !dismissed);
    } catch {
      setIsOpen(initialOpen ?? true);
    }
  }, [initialOpen, storageKey]);

  const totalSlides = slides.length;
  const isLast = activeIndex === totalSlides - 1;
  const isFirst = activeIndex === 0;

  const closeAndPersist = useCallback(() => {
    try {
      localStorage.setItem(storageKey, "1");
    } catch {}
    setIsOpen(false);
    onClose?.();
  }, [onClose, storageKey]);

  const goNext = useCallback(() => {
    if (isLast) {
      closeAndPersist();
      return;
    }
    setActiveIndex((i) => Math.min(i + 1, totalSlides - 1));
  }, [closeAndPersist, isLast, totalSlides]);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => Math.max(i - 1, 0));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAndPersist();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeAndPersist, goNext, goPrev, isOpen]);

  const activeSlide = useMemo(() => slides[activeIndex], [slides, activeIndex]);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Avoid SSR hydration issues
  if (!hasMounted || !isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-sm"
        onClick={closeAndPersist}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-title"
        className="relative w-[92vw] max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 shadow-2xl"
      >
        {/* Media */}
        <div className="relative aspect-video w-full bg-neutral-900">
          {activeSlide.mediaSrc ? (
            // Use img to keep setup simple without next/image requirements
            <img
              src={activeSlide.mediaSrc}
              alt={activeSlide.mediaAlt ?? activeSlide.title}
              className="h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
              No preview
            </div>
          )}
          {/* Subtle top edge highlight */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        </div>

        {/* Content */}
        <div className="space-y-4 p-6 md:p-8">
          <div className="text-center">
            <h2 id="intro-title" className="text-xl font-semibold tracking-tight text-white md:text-2xl">
              {activeSlide.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-300 md:text-base">
              {activeSlide.description}
            </p>
          </div>

          {/* Progress dots */}
          <div className="flex items-center justify-center gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setActiveIndex(i)}
                className={`h-2 w-2 rounded-full transition-colors ${
                  i === activeIndex ? "bg-white" : "bg-white/20 hover:bg-white/30"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="mt-2 flex items-center justify-between">
            <button
              className="rounded-md px-3 py-2 text-sm font-medium text-neutral-300 hover:text-white"
              onClick={closeAndPersist}
            >
              Skip
            </button>

            <div className="flex items-center gap-3">
              <button
                onClick={goPrev}
                disabled={isFirst}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/90 transition disabled:opacity-40 hover:bg-white/10"
              >
                Previous
              </button>
              <button
                onClick={goNext}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black shadow transition hover:bg-white/90"
              >
                {isLast ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


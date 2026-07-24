import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getErrorMessage } from "@/lib/api";
import { formatRedeemSuccessMessage, useRedeemCode } from "@/hooks/use-redeem-codes";
import type { RedeemCodeResult } from "@/types";

const MIN_LINE_COUNT = 5;
const MAX_CODE_LEN = 64;
const SUCCESS_ANIM_MS = 900;
const ERROR_FLASH_MS = 1400;

function normalizeRedeemInput(raw: string): string {
  return Array.from(raw)
    .filter((ch) => /^[\p{L}\p{N}]$/u.test(ch))
    .map((ch) => (/[a-z]/.test(ch) ? ch.toUpperCase() : ch))
    .slice(0, MAX_CODE_LEN)
    .join("");
}

function SuccessBorder({ active, onComplete }: { active: boolean; onComplete: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<SVGRectElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onCompleteEvent = useEffectEvent(onComplete);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    });
    ro.observe(wrap);
    setSize({ w: wrap.clientWidth, h: wrap.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const rect = rectRef.current;
    if (!active || !rect || size.w === 0) return;

    const length = rect.getTotalLength();
    rect.style.strokeDasharray = `${length}`;
    rect.style.strokeDashoffset = `${length}`;
    rect.getBoundingClientRect();
    rect.style.transition = `stroke-dashoffset ${SUCCESS_ANIM_MS}ms ease-out`;
    rect.style.strokeDashoffset = "0";

    const timer = window.setTimeout(() => onCompleteEvent(), SUCCESS_ANIM_MS + 40);
    return () => {
      window.clearTimeout(timer);
      rect.style.transition = "none";
      rect.style.strokeDashoffset = `${length}`;
    };
  }, [active, size.w, size.h]);

  const inset = 2;
  const radius = 16;

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {size.w > 0 && (
        <svg className="h-full w-full overflow-visible" width={size.w} height={size.h}>
          <defs>
            <linearGradient id="redeem-success-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="oklch(0.72 0.17 145)" />
              <stop offset="50%" stopColor="oklch(0.65 0.19 155)" />
              <stop offset="100%" stopColor="oklch(0.58 0.2 165)" />
            </linearGradient>
          </defs>
          <rect
            ref={rectRef}
            x={inset}
            y={inset}
            width={Math.max(0, size.w - inset * 2)}
            height={Math.max(0, size.h - inset * 2)}
            rx={radius}
            ry={radius}
            fill="none"
            stroke="url(#redeem-success-stroke)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={active ? 1 : 0}
          />
        </svg>
      )}
    </div>
  );
}

function CornerOrnament({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute h-5 w-5 border-brand/25",
        className
      )}
    />
  );
}

export function RedeemCodeBox() {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingResultRef = useRef<RedeemCodeResult | null>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const redeemMutation = useRedeemCode();

  const chars = Array.from(value);
  const hasInput = chars.length > 0;
  const slotCount = Math.max(MIN_LINE_COUNT, chars.length);
  const busy = redeemMutation.isPending || feedback === "success";
  const caretIndex = chars.length;

  const focusInput = () => {
    const el = inputRef.current;
    if (!el || busy) return;
    el.focus();
    const len = el.value.length;
    el.setSelectionRange(len, len);
  };

  const handleSuccessComplete = useEffectEvent(() => {
    const data = pendingResultRef.current;
    if (!data) return;
    pendingResultRef.current = null;
    toast.success(formatRedeemSuccessMessage(data, t));
    setValue("");
    setFeedback("idle");
    focusInput();
  });

  const handleRedeem = () => {
    const code = value.trim();
    if (!code || busy) return;

    redeemMutation.mutate(code, {
      onSuccess: (res) => {
        pendingResultRef.current = res.data as RedeemCodeResult;
        setFeedback("success");
      },
      onError: (err) => {
        setFeedback("error");
        toast.error(getErrorMessage(err, t));
        window.setTimeout(() => {
          setFeedback("idle");
          focusInput();
        }, ERROR_FLASH_MS);
      },
    });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [chars.length]);

  return (
      <div
            role="group"
            className={cn(
              "relative cursor-text select-none overflow-hidden rounded-2xl border transition-[background-color,border-color,box-shadow] duration-300",
              feedback === "error"
                ? "animate-[redeem-shake_0.45s_ease-in-out] border-red-400/80 bg-red-50/80 shadow-[0_0_0_1px_rgba(239,68,68,0.15)] dark:border-red-500/70 dark:bg-red-950/40"
                : feedback === "success"
                  ? "border-emerald-500/30 bg-emerald-50/50 shadow-[0_0_32px_-8px_rgba(16,185,129,0.35)] dark:border-emerald-500/25 dark:bg-emerald-950/20"
                  : "border-border/70 bg-card/80 shadow-sm"
            )}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              e.preventDefault();
              focusInput();
            }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_70%_at_50%_0%,color-mix(in_oklch,var(--color-brand)_14%,transparent),transparent_65%)] opacity-70"
            />
            <CornerOrnament className="left-3 top-3 border-l-2 border-t-2 rounded-tl-sm" />
            <CornerOrnament className="right-3 top-3 border-r-2 border-t-2 rounded-tr-sm" />
            <CornerOrnament className="bottom-3 left-3 border-b-2 border-l-2 rounded-bl-sm" />
            <CornerOrnament className="right-3 bottom-3 border-b-2 border-r-2 rounded-br-sm" />

            <SuccessBorder active={feedback === "success"} onComplete={handleSuccessComplete} />

            <input
              ref={inputRef}
              value={value}
              onChange={(e) => {
                if (feedback === "error") setFeedback("idle");
                const next = normalizeRedeemInput(e.target.value);
                setValue(next);
                requestAnimationFrame(() => {
                  const el = inputRef.current;
                  if (!el) return;
                  const len = el.value.length;
                  el.setSelectionRange(len, len);
                });
              }}
              onFocus={() => {
                setFocused(true);
                const el = inputRef.current;
                if (!el) return;
                const len = el.value.length;
                el.setSelectionRange(len, len);
              }}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleRedeem();
                  return;
                }
                if (e.key === "Backspace") {
                  e.preventDefault();
                  if (feedback === "error") setFeedback("idle");
                  setValue((prev) => Array.from(prev).slice(0, -1).join(""));
                  return;
                }
                if (e.key === "Delete") {
                  e.preventDefault();
                  if (feedback === "error") setFeedback("idle");
                  setValue((prev) => Array.from(prev).slice(0, -1).join(""));
                }
              }}
              disabled={busy}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-label={t("credits.redeemPlaceholder")}
              className="sr-only"
            />

            <div className="relative z-0 flex min-h-[200px] flex-col justify-center px-4 pb-6 pt-10 sm:px-6 sm:pb-7 sm:pt-12">
              {!hasInput && (
                <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-xs text-muted-foreground">
                  {t("credits.redeemPlaceholder")}
                </p>
              )}

              <div
                ref={scrollRef}
                data-redeem-slots
                className="redeem-slots-scroll w-full overflow-x-auto overflow-y-hidden"
              >
                <div className="mx-auto flex w-max min-w-full items-center justify-center gap-2.5 px-1 sm:gap-3">
                  {Array.from({ length: slotCount }).map((_, i) => {
                    const lit = i < chars.length;
                    const showCaret = focused && !busy && !lit && caretIndex === i;
                    const isActiveSlot = lit || showCaret;

                    return (
                      <div key={i} className="flex w-11 shrink-0 flex-col items-center gap-3 sm:w-12">
                        <span
                          className={cn(
                            "relative flex h-11 items-center justify-center font-mono text-3xl font-semibold tracking-wide sm:h-12 sm:text-4xl",
                            lit
                              ? feedback === "error"
                                ? "text-red-700 dark:text-red-300"
                                : "text-foreground"
                              : ""
                          )}
                        >
                          {lit && (
                            <span key={`${i}-${chars[i]}`} className="animate-redeem-char-enter inline-block">
                              {chars[i]}
                            </span>
                          )}
                          {showCaret && (
                            <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 animate-redeem-caret rounded-full bg-brand shadow-[0_0_6px_color-mix(in_oklch,var(--color-brand)_60%,transparent)]" />
                          )}
                        </span>

                        <span
                          className={cn(
                            "h-1 w-full rounded-full transition-all duration-300",
                            isActiveSlot
                              ? feedback === "error"
                                ? "bg-red-500/70"
                                : "bg-brand/70 shadow-[0_0_8px_color-mix(in_oklch,var(--color-brand)_45%,transparent)]"
                              : "bg-brand/25 dark:bg-brand/30"
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div
              className={cn(
                "relative z-20 overflow-hidden border-t border-border/50 transition-all duration-300",
                hasInput ? "max-h-16 opacity-100" : "max-h-0 opacity-0 border-transparent"
              )}
            >
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRedeem();
                }}
                disabled={busy}
                className={cn(
                  "flex w-full items-center justify-center gap-2 px-5 py-3.5 text-sm font-semibold tracking-wide transition-colors",
                  "disabled:pointer-events-none disabled:opacity-60",
                  feedback === "error"
                    ? "bg-gradient-to-r from-red-600 to-red-500 text-white hover:from-red-700 hover:to-red-600"
                    : feedback === "success"
                      ? "bg-gradient-to-r from-emerald-600 to-emerald-500 text-white"
                      : "bg-gradient-to-r from-brand to-[var(--color-brand-gradient-end)] text-brand-foreground hover:brightness-105"
                )}
              >
                {redeemMutation.isPending ? t("credits.redeeming") : t("credits.redeemSubmit")}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
  );
}

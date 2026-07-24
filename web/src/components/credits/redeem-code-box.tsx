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
  const radius = 14;

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {size.w > 0 && (
        <svg className="h-full w-full overflow-visible" width={size.w} height={size.h}>
          <rect
            ref={rectRef}
            x={inset}
            y={inset}
            width={Math.max(0, size.w - inset * 2)}
            height={Math.max(0, size.h - inset * 2)}
            rx={radius}
            ry={radius}
            fill="none"
            stroke="rgb(34 197 94)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={active ? 1 : 0}
          />
        </svg>
      )}
    </div>
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
  // 超过 5 位时末尾多留一个空位（多一条空横线给光标）
  const slotCount =
    chars.length > MIN_LINE_COUNT
      ? chars.length + 1
      : MIN_LINE_COUNT;
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

  // 新增字符后滚到最右侧，保证最新一位可见
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
  }, [chars.length]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">{t("credits.redeemTitle")}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{t("credits.redeemDesc")}</p>
      </div>

      <div
        role="group"
        className={cn(
          "relative min-h-[168px] cursor-text select-none overflow-hidden rounded-2xl border transition-[background-color,border-color,box-shadow] duration-300",
          feedback === "error"
            ? "animate-[redeem-shake_0.45s_ease-in-out] border-red-400 bg-red-100 dark:border-red-500 dark:bg-red-950/70"
            : feedback === "success"
              ? "border-transparent bg-brand-muted"
              : "border-brand/15 bg-brand-muted hover:border-brand/25"
        )}
        onMouseDown={(e) => {
          // 避免点击框体时按坐标把光标插到字符串中间，导致 Backspace 删不掉
          if (e.target === e.currentTarget || (e.target as HTMLElement).closest("[data-redeem-slots]")) {
            e.preventDefault();
            focusInput();
          }
        }}
      >
        <SuccessBorder active={feedback === "success"} onComplete={handleSuccessComplete} />

        {/* 视觉上隐藏：避免全屏透明 input 把点击位置映射成光标 */}
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
            // 显式处理删除，避免光标不在末尾时 Backspace 无效
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

        <div className="relative z-0 flex min-h-[168px] flex-col justify-center px-5 pb-14 pt-10 sm:px-8">
          <div
            ref={scrollRef}
            data-redeem-slots
            className="redeem-slots-scroll w-full overflow-x-auto overflow-y-hidden"
          >
            <div
              className="mx-auto flex w-max min-w-full items-end justify-center gap-3 px-1 sm:gap-4"
            >
              {Array.from({ length: slotCount }).map((_, i) => {
                const lit = i < chars.length;
                const showCaret = focused && !busy && caretIndex === i;
                return (
                  <div key={i} className="flex w-9 shrink-0 flex-col items-center gap-2.5 sm:w-10">
                    <span
                      className={cn(
                        "relative flex h-9 items-center justify-center font-mono text-2xl font-semibold tracking-wide sm:text-3xl",
                        lit
                          ? feedback === "error"
                            ? "text-red-700 dark:text-red-300"
                            : "text-foreground"
                          : "text-transparent"
                      )}
                    >
                      {chars[i] ?? "·"}
                      {showCaret && (
                        <span className="absolute inset-y-1 left-1/2 w-0.5 -translate-x-1/2 animate-redeem-caret rounded-full bg-brand" />
                      )}
                    </span>
                    <span
                      className={cn(
                        "h-1 w-full rounded-full transition-all duration-200",
                        lit
                          ? feedback === "error"
                            ? "bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.45)]"
                            : "bg-brand shadow-[0_0_10px_color-mix(in_oklch,var(--color-brand)_40%,transparent)]"
                          : showCaret
                            ? "bg-brand/55"
                            : "bg-brand/20 dark:bg-brand/30"
                      )}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {hasInput && (
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
              "absolute bottom-4 right-4 z-30 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium",
              "animate-in fade-in-0 slide-in-from-bottom-1 duration-200",
              "disabled:pointer-events-none disabled:opacity-60",
              feedback === "error"
                ? "bg-red-600 text-white hover:bg-red-700"
                : "bg-brand text-brand-foreground hover:bg-brand/90"
            )}
          >
            {redeemMutation.isPending ? t("credits.redeeming") : t("credits.redeemSubmit")}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-xl items-center gap-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-lg border border-line bg-lavender-50 px-3 py-1.5 font-mono text-xs" aria-label="Ссылка на анкету" />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-white hover:bg-lavender-50"
        aria-label="Скопировать ссылку"
        title="Скопировать"
      >
        {copied ? <Check className="size-4 text-level-good" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}


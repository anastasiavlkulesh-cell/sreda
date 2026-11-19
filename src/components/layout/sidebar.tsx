"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Sparkles, Radar, SearchCheck, ClipboardList, ListChecks, Users, TrendingUp, FileText,
  GraduationCap, BookOpen, HeartHandshake, Settings, Menu, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup, NavItem } from "./nav";

const ICONS = {
  LayoutDashboard, Sparkles, Radar, SearchCheck, ClipboardList, ListChecks, Users, TrendingUp, FileText,
  GraduationCap, BookOpen, HeartHandshake, Settings,
} as const;

function Item({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
  if (!item.ready) {
    return (
      <span className="flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sm text-white/35" title="Модуль запланирован на следующие этапы" aria-disabled="true">
        <Icon className="size-4" />
        <span className="flex-1">{item.label}</span>
        <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Скоро</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-lavender-500 text-white shadow-lg shadow-lavender-500/25" : "text-white/75 hover:bg-white/8 hover:text-white",
      )}
    >
      <Icon className="size-4" />
      {item.label}
    </Link>
  );
}

export function Sidebar({ groups, settings }: { groups: NavGroup[]; settings: NavItem | null }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const content = (
    <nav aria-label="Основная навигация" className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-3" onClick={() => setOpen(false)}>
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-lavender-500 to-lilac-400 font-display text-lg font-extrabold text-white">С</span>
        <span>
          <span className="block font-display text-lg font-extrabold tracking-wide text-white">СРЕДА</span>
          <span className="block text-[11px] text-white/45">качество бизнеса</span>
        </span>
      </Link>
      {groups.map((g) => (
        <div key={g.title} className="space-y-1">
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-white/35">{g.title}</p>
          {g.items.map((i) => (
            <Item key={i.href} item={i} active={isActive(i.href)} onNavigate={() => setOpen(false)} />
          ))}
        </div>
      ))}
      {settings && (
        <div className="mt-auto border-t border-white/10 pt-4">
          <Item item={settings} active={isActive(settings.href)} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </nav>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print fixed left-3 top-3 z-40 flex size-10 items-center justify-center rounded-xl bg-navy-900 text-white lg:hidden"
        aria-label="Открыть меню"
      >
        <Menu className="size-5" />
      </button>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-navy-900 lg:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-navy-900">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-4 text-white/70" aria-label="Закрыть меню">
              <X className="size-5" />
            </button>
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

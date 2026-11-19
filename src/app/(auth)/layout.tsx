export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-navy-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-lavender-500 to-lilac-400 font-display text-xl font-extrabold">С</span>
          <span className="font-display text-xl font-extrabold tracking-wide">СРЕДА</span>
        </div>
        <div className="relative z-10 max-w-md space-y-5">
          <p className="font-display text-4xl font-extrabold leading-tight">
            Сервис начинается с отношения.
            <span className="block text-peach-400">Результат создаётся системой.</span>
          </p>
          <p className="text-white/65">
            Диагностика SERVICE 5D, поиск первопричин, план улучшений и контроль реального результата — в одной системе.
          </p>
        </div>
        <p className="text-xs text-white/40">Интеллектуальная система управления качеством бизнеса</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-lavender-500/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 size-80 rounded-full bg-peach-400/15 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

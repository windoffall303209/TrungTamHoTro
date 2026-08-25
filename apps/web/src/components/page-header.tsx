export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 border-b border-slate-200 pb-7 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl"><p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-sky-700">{eyebrow}</p><h1 className="mt-2 font-heading text-3xl font-extrabold tracking-[-0.035em] text-slate-950 md:text-4xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">{description}</p></div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}


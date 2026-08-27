export function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5 border-b border-[#a9bac1] pb-7 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl"><h1 className="font-heading text-3xl font-bold tracking-[-0.03em] text-[#102a43] md:text-4xl">{title}</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[#516274] md:text-base">{description}</p><span className="sr-only">{eyebrow}</span></div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

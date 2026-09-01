export function PageHeader({ title, description, actions }: { eyebrow: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="-mt-4 flex flex-col gap-4 border-b border-[#a9bac1] pb-5 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl"><h1 className="font-heading text-[1.40625rem] font-bold leading-tight tracking-[-0.03em] text-[#102a43] md:text-[1.59375rem]">{title}</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-[#516274] md:text-base">{description}</p></div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

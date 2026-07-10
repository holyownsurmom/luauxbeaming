export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-muted-foreground">{description}</p>
      </header>
      <div className="rounded-2xl brutal-border bg-card p-10 text-center">
        <div className="inline-flex items-center gap-2 rounded-full brutal-border bg-primary/10 px-3 py-1 text-[10px] uppercase tracking-widest text-primary">
          Coming soon
        </div>
        <p className="mt-4 text-sm text-muted-foreground max-w-md mx-auto">
          This surface is being built. Drop your requirements in Discord and it'll appear here.
        </p>
      </div>
    </div>
  );
}
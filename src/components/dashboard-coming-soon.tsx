import { Sparkles } from "lucide-react";
import { EmptyState, PageHeader, PageShell, Surface } from "@/components/dashboard-ui";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <PageShell>
      <PageHeader title={title} description={description} />
      <Surface>
        <EmptyState
          icon={Sparkles}
          title="Coming soon"
          description="This surface is being built. Share requirements in Discord and it will land here."
        />
      </Surface>
    </PageShell>
  );
}

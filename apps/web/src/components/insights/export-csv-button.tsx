"use client";

import { FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { minimumPlanFor, PLANS } from "@/lib/plans";
import { api } from "@/trpc/react";

type ExportCsvButtonProps = {
  videoId: string;
  enabled: boolean;
};

/** Triggers a browser download for a CSV string. */
function downloadCsv(csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ryloom-video-analytics-${Date.now()}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ExportCsvButton({ videoId, enabled }: ExportCsvButtonProps) {
  const exportCsv = api.analytics.exportCsv.useMutation({
    onSuccess: (csv) => {
      downloadCsv(csv);
      toast.success("Analytics CSV downloaded");
    },
    onError: (error) => toast.error(error.message),
  });

  if (!enabled) {
    const planName = PLANS[minimumPlanFor("exportAnalyticsCsv")].name;
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} className="inline-flex">
              <Button variant="outline" disabled>
                <FileDown className="size-4" />
                Export CSV
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            CSV export is available on the {planName} plan
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      variant="outline"
      disabled={exportCsv.isPending}
      onClick={() => exportCsv.mutate({ videoId })}
    >
      {exportCsv.isPending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FileDown className="size-4" />
      )}
      Export CSV
    </Button>
  );
}

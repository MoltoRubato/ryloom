import { type Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

import { RecorderApp } from "@/components/recorder/recorder-app";

export const metadata: Metadata = {
  title: "Record",
  description: "Record your screen and camera, then share with a link.",
};

export default function RecordPage() {
  return (
    <div className="dark min-h-dvh bg-background text-foreground">
      <Suspense
        fallback={
          <div className="flex min-h-dvh items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <RecorderApp />
      </Suspense>
    </div>
  );
}

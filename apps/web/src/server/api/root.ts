import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

import { adminRouter } from "@/server/api/routers/admin";
import { aiRouter } from "@/server/api/routers/ai";
import { analyticsRouter } from "@/server/api/routers/analytics";
import { billingRouter } from "@/server/api/routers/billing";
import { commentRouter } from "@/server/api/routers/comment";
import { folderRouter } from "@/server/api/routers/folder";
import { notificationRouter } from "@/server/api/routers/notification";
import { reactionRouter } from "@/server/api/routers/reaction";
import { recordingRouter } from "@/server/api/routers/recording";
import { searchRouter } from "@/server/api/routers/search";
import { transcriptRouter } from "@/server/api/routers/transcript";
import { userRouter } from "@/server/api/routers/user";
import { videoRouter } from "@/server/api/routers/video";
import { workspaceRouter } from "@/server/api/routers/workspace";

export const appRouter = createTRPCRouter({
  user: userRouter,
  workspace: workspaceRouter,
  folder: folderRouter,
  recording: recordingRouter,
  video: videoRouter,
  comment: commentRouter,
  reaction: reactionRouter,
  analytics: analyticsRouter,
  transcript: transcriptRouter,
  ai: aiRouter,
  billing: billingRouter,
  admin: adminRouter,
  notification: notificationRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);

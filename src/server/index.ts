import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    console.log(`Jev Content Filtering API listening on http://localhost:${info.port}`);
  }
);

export default app;

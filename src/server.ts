import { createApp } from "./app";

const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`omnitenant-account listening on :${port}`);
});

import express from "express";
import { WatcherStatus } from "./types/types";

let statusMap: Record<string, WatcherStatus> = {};

export function updateWatcherStatus(id: string, status: WatcherStatus) {
  statusMap[id] = status;
}

export function expireWatcherStatus(id: string) {
  if (statusMap[id]) {
    statusMap[id].active = false;
  }
}

export function getStatusMap() {
  return statusMap;
}

export function createWebServer(port = 3000) {
  const app = express();
  app.use(express.json());

  app.get("/status", (_, res) => {
    res.json(getStatusMap());
  });

  app.post("/trigger", async (req, res) => {
    res.json({ ok: true, msg: "Manual trigger accepted", input: req.body });
  });

  app.listen(port, () => {
    console.log(`\u{1F310} Webhook server running on http://localhost:${port}`);
  });
}
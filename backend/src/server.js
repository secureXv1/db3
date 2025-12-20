import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import detectionsRouter from "./routes/detections.js";
import ingestRouter from "./routes/ingest.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (_req, res) => res.json({ ok: true, name: "geo-backend" }));
app.use("/api/detections", detectionsRouter);
app.use("/api/ingest", ingestRouter);

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`API escuchando en http://0.0.0.0:${PORT}`);
});

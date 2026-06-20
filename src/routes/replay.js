import { Router } from "express";
import { z } from "zod";
import { saveReplay } from "../services/gameService.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

const saveReplaySchema = z.object({
  wallet: z.string().min(1),
  sessionId: z.string().min(1),
  replayURI: z
    .string()
    .min(1)
    .refine(
      (value) => value.startsWith("ipfs://") || value.startsWith("https://"),
      "replayURI must be an ipfs:// or https:// URI"
    )
});

router.post(
  "/save",
  asyncHandler(async (req, res) => {
    const input = saveReplaySchema.parse(req.body);
    const session = await saveReplay(input);

    res.json({
      replayURI: session.replayGifUrl,
      sessionId: session.id
    });
  })
);

export default router;

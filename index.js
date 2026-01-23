import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import multer from "multer";
import crypto from "crypto";
import Razorpay from "razorpay";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "./supabase.js";



const app = express();
app.use(cors());
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; }}));

// ================= MULTER =================
const upload = multer({
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Only JPG, PNG, WEBP allowed"), false);
  }
});

// ================= GEMINI =================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const textModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const imageModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

// ================= RAZORPAY =================
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ================= PROMPT ENGINE (FINAL) =================
function buildPrompt({ name, role, style }) {
  const powers = [
    "energy manipulation",
    "shadow bending",
    "light control",
    "time distortion",
    "spiritual aura projection",
    "elemental fusion",
    "dimensional blade control",
    "cosmic resonance",
    "telekinetic force",
    "soul flame awakening"
  ];

  const power = powers[Math.floor(Math.random() * powers.length)];

  return `
Create a cinematic anime movie frame inspired by the ${style} visual universe.

MAIN CHARACTER IDENTITY (CRITICAL):
- The main character must be an anime-style transformation of the uploaded face.
- Facial structure, proportions, and expression must match the uploaded portrait.
- The character must feel native to this universe while remaining recognizable.
- Gender, ethnicity, and age impression must remain unchanged.
- Never copy or resemble any existing anime character.

NAME & ROLE:
- Display "${name}" as "${role}" using anime-styled typography.
- Text must be cinematic and subtle, never overpowering.

UNIQUE POWER:
- The character possesses a unique power: ${power}.
- Visualize through aura, energy, lighting, or environment reaction.

BACKGROUND:
- Include supporting side characters that fit the same universe.
- They must enhance depth without stealing focus.

SCENE:
- Anime movie-quality composition.
- Cinematic lighting, depth of field, dynamic camera.
- Dramatic atmosphere, high resolution, no watermark.

STRICT RULES:
- No real anime names.
- No reused anime faces.
- Prioritize uploaded face identity.
`;
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.json({ status: "AniVerse AI backend running" });
});

// ================= GENERATE =================
app.post("/generate", upload.single("image"), async (req, res) => {
  let user;

  try {
    const { email, name, role, style } = req.body;
    if (!email || !name || !role || !style || !req.file)
      return res.status(400).json({ error: "Missing required fields" });

    const { data } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    user = data;

    if (!user) {
      const { data: newUser } = await supabase
        .from("users")
        .insert([{ email, credits: 2 }])
        .select()
        .single();
      user = newUser;
    }

    if (user.credits <= 0)
      return res.status(403).json({ error: "No credits remaining" });

    const prompt = buildPrompt({ name, role, style });

    const textResponse = await textModel.generateContent(prompt);
    const finalPrompt = textResponse.response.text();

    const imageResponse = await imageModel.generateContent([
      finalPrompt,
      {
        inlineData: {
          mimeType: req.file.mimetype,
          data: req.file.buffer.toString("base64")
        }
      }
    ]);

    const base64Image =
      imageResponse.response.candidates[0].content.parts[0].inlineData.data;

    const buffer = Buffer.from(base64Image, "base64");
    const fileName = `aniverse-${Date.now()}.jpg`;

    await supabase.storage
      .from("aniverse-images")
      .upload(fileName, buffer, { contentType: "image/jpeg" });

    const { data: file } = supabase.storage
      .from("aniverse-images")
      .getPublicUrl(fileName);

    await supabase.from("generations").insert([{
      user_id: user.id,
      style,
      role,
      image_url: file.publicUrl
    }]);

    await supabase
      .from("users")
      .update({ credits: user.credits - 1 })
      .eq("id", user.id);

    await supabase.from("credit_logs").insert([{
      user_id: user.id,
      change: -1,
      reason: "image_generation"
    }]);

    res.json({
      success: true,
      imageUrl: file.publicUrl,
      remainingCredits: user.credits - 1
    });

  } catch (error) {
    console.error("GEN ERROR:", error.message);

    if (error.message?.includes("Quota") || error.message?.includes("429")) {
      return res.json({
        success: true,
        demo: true,
        imageUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2",
        remainingCredits: user ? user.credits : 0
      });
    }

    res.status(500).json({ error: error.message });
  }
});

// ================= PAYMENTS =================
app.post("/create-order", async (req, res) => {
  const { amount } = req.body;

  const order = await razorpay.orders.create({
    amount: amount * 100,
    currency: "INR"
  });

  res.json(order);
});

app.post("/razorpay-webhook", async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const body = req.rawBody;

  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  if (signature !== expected)
    return res.status(400).send("Invalid signature");

  const event = JSON.parse(body.toString());

  if (event.event === "payment.captured") {
    const payment = event.payload.payment.entity;
    const credits = Math.floor(payment.amount / 100);

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", payment.email)
      .single();

    if (user) {
      await supabase.from("payments").insert([{
        user_id: user.id,
        payment_id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        provider: "razorpay",
        credits_added: credits,
        status: "success"
      }]);

      await supabase.rpc("increment_credits", {
        uid: user.id,
        amount: credits
      });
    }
  }

  res.json({ status: "ok" });
});

// ================= API =================
app.get("/user", async (req, res) => {
  const { email } = req.query;
  const { data } = await supabase
    .from("users")
    .select("email, credits, created_at")
    .eq("email", email)
    .single();
  res.json(data);
});

app.get("/gallery", async (_, res) => {
  const { data } = await supabase
    .from("generations")
    .select("*")
    .order("created_at", { ascending: false });
  res.json(data);
});

app.get("/my-gallery", async (req, res) => {
  const { email } = req.query;
  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .single();

  const { data } = await supabase
    .from("generations")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  res.json(data);
});

// ================= SERVER =================
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`AniVerse AI running on ${PORT}`));

export default app;

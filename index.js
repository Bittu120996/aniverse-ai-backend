import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabase } from "./supabase.js";

const app = express();
app.use(cors());
app.use(express.json());

// ================= MULTER =================
const upload = multer({
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, and WEBP images are allowed"), false);
  }
});

// ================= GEMINI =================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const textModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const imageModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

// ================= PROMPT =================
function buildPrompt({ name, role, style }) {
  return `Create a cinematic anime frame in ${style} style for ${name} as ${role}.`;
}

// ================= ROUTES =================
app.get("/", (req, res) => {
  res.json({ status: "AniVerse AI backend running successfully" });
});

// ================= GENERATE =================
app.post("/generate", upload.single("image"), async (req, res) => {

  let user; // <<< FIXED SCOPE

  try {
    const { email, name, role, style } = req.body;

    if (!req.file)
      return res.status(400).json({ error: "Valid portrait image required" });

    if (!email || !name || !role || !style)
      return res.status(400).json({ error: "Email, name, role, and style are required" });

    let { data } = await supabase
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
      return res.status(403).json({ success: false, error: "No credits remaining" });

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

    const { error: uploadError } = await supabase.storage
      .from("aniverse-images")
      .upload(fileName, buffer, { contentType: "image/jpeg" });

    if (uploadError) throw uploadError;

    const { data: fileData } = supabase.storage
      .from("aniverse-images")
      .getPublicUrl(fileName);

    await supabase.from("generations").insert([{
      user_id: user.id,
      style,
      role,
      image_url: fileData.publicUrl
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

    return res.json({
      success: true,
      imageUrl: fileData.publicUrl,
      remainingCredits: user.credits - 1
    });

  } catch (error) {
    console.error("AniVerse Error FULL:", error);

    // ===== DEMO FALLBACK =====
    if (error.message?.includes("Quota") || error.message?.includes("429")) {
      return res.json({
        success: true,
        imageUrl: "https://6971f8520fbe657fd5e6336d.imgix.net/we%20will%20live%20soon?w=594&h=1024&rect=223%2C0%2C594%2C1024",
        remainingCredits: user ? user.credits : 0,
        demo: true
      });
    }

    return res.status(500).json({
      success: false,
      error: error.message || error.toString()
    });
  }
});

// ================= API =================
app.get("/gallery", async (req, res) => {
  const { data } = await supabase.from("generations").select("*");
  res.json(data);
});

// ================= SERVER =================
const PORT = process.env.PORT || 3333;
app.listen(PORT, () => console.log(`AniVerse AI running on ${PORT}`));

export default app;

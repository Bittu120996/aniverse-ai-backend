import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";



dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ================= MULTER IMAGE FILTER =================

const upload = multer({
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WEBP images are allowed"), false);
    }
  }
});

// ================= GEMINI SETUP =================

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const textModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
const imageModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

// ================= PROMPT ENGINE =================

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

Main Character Identity Rules:
- The main character must be an anime-style transformation of the uploaded face.
- The face must clearly resemble the same real person.
- Facial proportions, structure, and expression must match the uploaded portrait.
- The face must be adapted naturally into the anime universe style, not copied from any existing anime character.
- The character must look like a native character of this anime universe while still being recognizable as the same person.
- Gender must remain exactly the same as in the uploaded image.
- Do not change ethnicity, age impression, or identity.

Character Presence:
- The main character is the visual focus and emotional center of the frame.

Name and Role Display:
- Show the name "${name}" and role "${role}" inside the frame.
- Typography must match the anime universe aesthetic.
- Font size must be balanced and cinematic.
- Text must never overshadow the main character.

Unique Ability:
- The main character possesses a unique power: ${power}.
- The power should be visible through aura, light effects, environment reaction, or energy flow.

Background Characters:
- Include multiple side characters that belong naturally to the same anime universe style.
- Side characters must support the narrative and scene depth.

Scene Composition:
- Cinematic depth of field.
- Dynamic lighting and shadows.
- Dramatic atmosphere.
- Balanced color grading.
- Anime movie quality composition.

Immersion Rule:
- The viewer must feel that the user truly exists inside this anime universe.

Camera:
- Cinematic anime lens perspective.
- Sharp focus on main character.
- Slight background blur.

Quality and Integrity:
- Ultra high resolution.
- No watermark.
- No distortion.
- No western realism.

Important Restrictions:
- Never copy or imitate any specific anime character face.
- Never reference real anime series.
- Always prioritize the uploaded face identity.
- The character must look original, authentic, and universe-consistent.
`;
}

// ================= ROUTES =================

app.get("/", (req, res) => {
  res.json({ status: "AniVerse AI backend running successfully" });
});

app.post("/generate", upload.single("image"), async (req, res) => {
  try {
    const { name, role, style } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "Valid portrait image required" });
    }

    if (!name || !role || !style) {
      return res.status(400).json({ error: "Name, role, and style are required" });
    }

    const prompt = buildPrompt({ name, role, style });

    // Step 1: Prompt enhancement
    const textResponse = await textModel.generateContent(prompt);
    const finalPrompt = textResponse.response.text();

    // Step 2: Image generation
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

    res.json({
      success: true,
      imageBase64: base64Image
    });

  } catch (error) {
    console.error("AniVerse Error:", error.message);

    res.status(500).json({
      success: false,
      error: error.message || "AniVerse AI generation failed"
    });
  }
});

//// temporary///
console.log("Gemini key loaded:", process.env.GEMINI_API_KEY ? "YES" : "NO");

const PORT = process.env.PORT || 3333;

app.listen(PORT, () => {
  console.log(`AniVerse AI backend running on port ${PORT}`);
});

console.log("Image model in use:", imageModel.model);


export default app;

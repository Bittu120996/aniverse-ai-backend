import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE;

if (!supabaseUrl || !supabaseServiceRole) {
  throw new Error("Supabase environment variables are missing");
}

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRole,
  {
    auth: {
      persistSession: false
    }
  }
);


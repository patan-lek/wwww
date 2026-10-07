import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { localVocabularyApi } from "./server/vocabularyApi";

export default defineConfig({ plugins: [react(), localVocabularyApi()] });

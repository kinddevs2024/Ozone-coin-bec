/**
 * Backend server entry. Run: npm run dev (or npm start after build).
 */
import app from "./app.js";

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});

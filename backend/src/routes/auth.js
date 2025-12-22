import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db.js";
import { authRequired } from "../auth.js";

const router = Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || "12h" }
  );
}

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: "username y password son requeridos" });
    }

    const r = await pool.query(
      `SELECT id, username, password_hash, role, is_active
       FROM users
       WHERE username = $1
       LIMIT 1`,
      [String(username).trim()]
    );

    const u = r.rows[0];
    if (!u || !u.is_active) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });

    const ok = await bcrypt.compare(String(password), u.password_hash);
    if (!ok) return res.status(401).json({ ok: false, error: "Credenciales inválidas" });

    const token = signToken(u);

    res.json({
      ok: true,
      token,
      user: { id: u.id, username: u.username, role: u.role }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// devuelve usuario desde el token
router.get("/me", authRequired, async (req, res) => {
  res.json({ ok: true, user: req.user });
});

export default router;

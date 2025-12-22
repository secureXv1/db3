import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "No autorizado" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { id, username, role }
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "No autorizado" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ ok: false, error: "Prohibido" });
    next();
  };
}
